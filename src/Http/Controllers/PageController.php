<?php

namespace Lookout\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\View\View;
use Inertia\Inertia;
use Lookout\Lookout;
use Lookout\LookoutServiceProvider;
use Lookout\Services\Sources;
use Symfony\Component\HttpFoundation\Response;

/**
 * The Blade shell the Lookout SPA mounts into. Every client-side path under /{path} gets the same shell.
 */
class PageController extends Controller
{
    public function __invoke(Request $request): View|Response
    {
        // A Nova sidebar link is an Inertia visit: answer it with a full-page load of this page.
        if ($request->header('X-Inertia') && class_exists(Inertia::class)) {
            return Inertia::location($request->fullUrl());
        }

        $user = $request->user();
        $base = '/'.Lookout::path();

        // The shell has one-click actions (resolve, ignore, token toggles): never render it inside a frame.
        return response()->view('lookout::app', [
            'boot' => [
                'base_path' => $base,
                'api_base' => $base.'/api',
                'sources_enabled' => Sources::enabled(),
                ...self::navigation(),
                'title' => (string) (config('lookout.title') ?: 'Lookout'),
                'app_name' => config('lookout.brand') ?? config('app.name'),
                'environment' => config('nightowl.environment') ?? config('app.env'),
                'storage_prefix' => (string) config('lookout.storage_prefix', 'lookout-'),
                'user' => ['id' => $user->getAuthIdentifier(), 'name' => $user->name, 'email' => $user->email, 'avatar' => $user->profile_photo_url ?? null],
            ],
            'script' => self::asset('app.js'),
            'style' => self::asset('app.css'),
        ])->withHeaders([
            'X-Frame-Options' => 'DENY',
            'Content-Security-Policy' => "frame-ancestors 'none'",
        ]);
    }

    /**
     * Where the user menu leads: back to Nova with auth = nova, else the configured links.
     *
     * @return array{nova_path: ?string, home: ?array{label: string, url: string}, logout_url: ?string, login_url: ?string}
     */
    private static function navigation(): array
    {
        if (LookoutServiceProvider::usesNova()) {
            $nova = '/'.trim((string) config('nova.path', '/nova'), '/');

            return ['nova_path' => config('nova.path'), 'home' => ['label' => 'Open Nova', 'url' => $nova],
                'logout_url' => $nova.'/logout', 'login_url' => $nova.'/login'];
        }

        $home = config('lookout.home');

        return [
            'nova_path' => null,
            'home' => is_array($home) && isset($home['url']) ? ['label' => (string) ($home['label'] ?? 'Back to the app'), 'url' => (string) $home['url']] : null,
            'logout_url' => config('lookout.logout_url'),
            'login_url' => config('lookout.login_url'),
        ];
    }

    /**
     * URL of a built SPA file with its mtime as the version, so a deploy is never served a stale cached copy: the
     * published copy in public/vendor/lookout when there is one, else the package's own dist through the app.
     */
    private static function asset(string $file): ?string
    {
        $published = public_path('vendor/lookout/'.$file);
        if (is_file($published)) {
            return asset('vendor/lookout/'.$file).'?v='.filemtime($published);
        }

        $dist = AssetController::DIST.'/'.$file;

        return is_file($dist) ? url(Lookout::path().'/assets/'.$file).'?v='.filemtime($dist) : null;
    }
}
