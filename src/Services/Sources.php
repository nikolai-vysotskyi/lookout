<?php

namespace Lookout\Services;

use Illuminate\Database\Connection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Lookout\Lookout;

final class Sources
{
    public const SLUG = '[a-z0-9][a-z0-9_-]{0,63}';

    public const TOKEN = 'lks_[0-9a-f]{64}';

    public static function enabled(): bool
    {
        return (bool) config('lookout.sources.enabled', false);
    }

    public static function connectionName(): string
    {
        return (string) config('lookout.sources.connection', 'lookout_ingest');
    }

    public function connection(): Connection
    {
        return DB::connection(self::connectionName());
    }

    public function reader(): Connection
    {
        return DB::connection(Lookout::connection());
    }

    public function authenticate(string $token): ?object
    {
        if (! self::enabled() || ! preg_match('/\A'.self::TOKEN.'\z/', $token)) {
            return null;
        }

        return $this->connection()->table('lookout_sources')
            ->where('token_hash', hash('sha256', $token))
            ->where('connector', 'otlp')
            ->first(['id', 'project', 'slug', 'label', 'connector', 'environment']);
    }

    public function catalog(): array
    {
        if (! self::enabled()) {
            return ['projects' => [], 'services' => []];
        }

        return [
            'projects' => $this->reader()->table('lookout_projects')->orderBy('label')->get(['slug', 'label'])->all(),
            'services' => $this->scoped()->map(self::describe(...))->values()->all(),
        ];
    }

    /** NightOwl owns the existing environment dimension, while OTLP sources are registered in one environment. */
    public function scoped(?string $project = null, ?string $service = null, ?string $environment = null): Collection
    {
        if (! self::enabled()) {
            return collect();
        }

        return $this->reader()->table('lookout_sources')
            ->orderBy('label')->get(['id', 'project', 'slug', 'label', 'connector', 'environment'])
            ->filter(fn (object $source): bool => ($project === null || $project === $source->project)
                && ($service === null || $service === self::key($source))
                && ($environment === null || $source->environment === null || $environment === $source->environment));
    }

    public static function key(object $source): string
    {
        return $source->project.'/'.$source->slug;
    }

    public static function describe(object $source): array
    {
        return [
            'key' => self::key($source),
            'project' => $source->project,
            'slug' => $source->slug,
            'label' => $source->label,
            'connector' => $source->connector,
            'environment' => $source->environment,
        ];
    }
}
