<?php

namespace Lookout;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Laravel\Mcp\Facades\Mcp;
use Lookout\Console\AutoResolveCommand;
use Lookout\Console\PruneSourcesCommand;
use Lookout\Console\SourceCommand;
use Lookout\Console\TelegramNotifyCommand;
use Lookout\Contracts\SettingStore;
use Lookout\Http\Controllers\AssetController;
use Lookout\Http\Controllers\OtlpController;
use Lookout\Http\Controllers\PageController;
use Lookout\Http\Middleware\AuthenticateMcpToken;
use Lookout\Http\Middleware\EnsureLookoutAccess;
use Lookout\Mcp\LookoutServer;
use Lookout\Services\Sources;
use Lookout\Support\NightowlSettingStore;

/**
 * Lookout: the SPA shell at /{path}/{any?}, its JSON API at /{path}/api/*, the MCP server for coding
 * agents, the auto-resolve and Telegram commands and their schedule. See config/lookout.php.
 */
class LookoutServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/lookout.php', 'lookout');
        $this->app->singletonIf(SettingStore::class, NightowlSettingStore::class);
    }

    /**
     * The middleware in front of the shell and the API: the configured stack (or Nova's own API stack), then
     * EnsureLookoutAccess (enabled, gate).
     *
     * @return list<mixed>
     */
    public static function middleware(): array
    {
        $stack = self::usesNova() ? (array) config('nova.api_middleware', []) : (array) config('lookout.middleware', []);

        return [...array_values($stack), EnsureLookoutAccess::class];
    }

    public static function usesNova(): bool
    {
        return config('lookout.auth') === 'nova';
    }

    public function boot(): void
    {
        $this->loadViewsFrom(__DIR__.'/../resources/views', 'lookout');
        $this->loadMigrationsFrom(__DIR__.'/../database/migrations');
        $this->defineConnection();
        if (Sources::enabled()) {
            $this->defineMonitoringConnection(Sources::connectionName());
            $this->loadMigrationsFrom(__DIR__.'/../database/sources');
        }
        $this->rateLimiter();

        if ($this->app->runningInConsole()) {
            $this->commands([AutoResolveCommand::class, TelegramNotifyCommand::class, SourceCommand::class, PruneSourcesCommand::class]);
            $this->publishes([__DIR__.'/../config/lookout.php' => config_path('lookout.php')], 'lookout-config');
            $this->publishes([__DIR__.'/../database/migrations' => database_path('migrations')], 'lookout-migrations');
            $this->publishes([__DIR__.'/../dist' => public_path('vendor/lookout')], 'lookout-assets');
        }

        $this->callAfterResolving(Schedule::class, function (Schedule $schedule): void {
            if (config('lookout.auto_resolve.schedule', true)) {
                $schedule->command('lookout:auto-resolve')
                    ->dailyAt((string) config('lookout.auto_resolve.at', '03:40'))
                    ->when(fn (): bool => Lookout::enabled())
                    ->withoutOverlapping(30);
            }
            if (Sources::enabled()) {
                $schedule->command('lookout:prune-sources')->daily()->onOneServer()->withoutOverlapping();
            }
            if (config('lookout.telegram.enabled', true)) {
                $schedule->command('lookout:telegram-notify')
                    ->everyMinute()
                    ->when(fn (): bool => Lookout::enabled())
                    ->withoutOverlapping(10)
                    ->onOneServer();
            }
        });

        $this->app->booted(function (): void {
            $this->ignoreOwnRoutes();
            $this->routes();
        });
    }

    protected function routes(): void
    {
        if ($this->app->routesAreCached()) {
            return;
        }

        $group = Route::middleware(self::middleware());
        $domain = self::usesNova() ? config('nova.domain') : config('lookout.domain');
        if ($domain !== null && $domain !== '') {
            $group->domain($domain);
        }

        $path = Lookout::path();
        if (Sources::enabled()) {
            $ingest = Route::middleware(ThrottleRequests::using('lookout-ingest'));
            if ($ingestDomain = config('lookout.sources.ingest_domain') ?: $domain) {
                $ingest->domain($ingestDomain);
            }
            $ingest->group(fn () => Route::post($path.'/v1/traces', OtlpController::class)->name('lookout.ingest.traces'));
        }
        $group->group(function () use ($path): void {
            Route::prefix($path.'/api')->group(__DIR__.'/../routes/api.php');
            Route::get($path.'/assets/{file}', AssetController::class)->where('file', 'app\.(js|css)|fonts/[a-z-]+\.woff2')->name('lookout.assets');
            Route::get($path.'/{any?}', PageController::class)
                ->where('any', '^(?!api(/|$)).*')
                ->name('lookout');
        });

        if (config('lookout.mcp.enabled', true) && class_exists(Mcp::class)) {
            Mcp::web('/'.trim((string) config('lookout.mcp.path', 'mcp/lookout'), '/'), LookoutServer::class)
                ->middleware([AuthenticateMcpToken::class, ...self::mcpMiddleware()]);
        }
    }

    /**
     * Keeps Lookout's own traffic out of the telemetry it shows: its shell, API and assets, and the MCP route carry
     * tokens, webhook URLs and secrets that any other viewer would otherwise read on the request pages. Appends to
     * nightowl.ignore_routes (a list, or the comma-separated string a published config may hold) and keeps whatever
     * the app put there. The agent matches the patterns against route paths at drain time; exceptions are still kept.
     */
    protected function ignoreOwnRoutes(): void
    {
        if (! config('lookout.ignore_own_routes', true)) {
            return;
        }

        $configured = config('nightowl.ignore_routes', []);
        $patterns = is_array($configured) ? $configured : explode(',', (string) $configured);
        $path = Lookout::path();
        // An empty path would turn into "/*" and drop every request of the app.
        $own = $path === '' ? [] : [$path, $path.'/*'];
        if (config('lookout.mcp.enabled', true)) {
            $own[] = trim((string) config('lookout.mcp.path', 'mcp/lookout'), '/');
        }

        $patterns = array_map(fn ($p) => is_string($p) ? trim($p) : $p, $patterns);
        config(['nightowl.ignore_routes' => array_values(array_unique(array_filter([...$patterns, ...$own], fn ($p) => $p !== '' && $p !== null), SORT_REGULAR))]);
    }

    /**
     * What runs after the token check on the MCP route: lookout.mcp.middleware, or by default ThrottleRequests with
     * lookout.mcp.rate_limiter (per credential, see rateLimiter()).
     *
     * @return list<mixed>
     */
    public static function mcpMiddleware(): array
    {
        $middleware = config('lookout.mcp.middleware');

        if ($middleware === null) {
            return [ThrottleRequests::using((string) config('lookout.mcp.rate_limiter', 'lookout-mcp'))];
        }

        return array_values((array) $middleware);
    }

    /**
     * Per credential, high enough for several agent sessions at once.
     */
    protected function rateLimiter(): void
    {
        RateLimiter::for('lookout-ingest', fn (Request $request) => Limit::perMinute(max(1, (int) config('lookout.sources.per_minute', 600)))->by('lookout-ingest:'.$request->ip())
        );

        $name = (string) config('lookout.mcp.rate_limiter', 'lookout-mcp');

        RateLimiter::for($name, function (Request $request) use ($name) {
            $token = (string) ($request->header('X-Api-Token') ?? $request->bearerToken());

            return Limit::perMinute((int) config('lookout.mcp.per_minute', 600))
                ->by($token !== '' ? $name.':'.hash('sha256', $token) : $name.'-ip:'.$request->ip());
        });
    }

    /**
     * The read connection, unless the app defines it: NightOwl's own database settings.
     */
    protected function defineConnection(): void
    {
        $this->defineMonitoringConnection(Lookout::connection());
    }

    private function defineMonitoringConnection(string $name): void
    {
        if (config("database.connections.{$name}") !== null || ! is_array($nightowl = config('nightowl.database'))) {
            return;
        }

        config(["database.connections.{$name}" => [
            'driver' => 'pgsql',
            'host' => $nightowl['host'] ?? '127.0.0.1',
            'port' => $nightowl['port'] ?? '5432',
            'database' => $nightowl['database'] ?? 'nightowl',
            'username' => $nightowl['username'] ?? 'nightowl',
            'password' => $nightowl['password'] ?? '',
            'charset' => 'utf8',
            'prefix' => '',
            'prefix_indexes' => true,
            'search_path' => 'public',
            'sslmode' => $nightowl['sslmode'] ?? 'prefer',
        ]]);
    }
}
