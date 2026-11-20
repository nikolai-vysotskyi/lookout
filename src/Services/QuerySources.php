<?php

namespace Lookout\Services;

use Illuminate\Support\Collection;

final class QuerySources
{
    public function __construct(
        private SourceTelemetry $external,
        private Telemetry $legacy,
    ) {}

    public function list(Window $window, Collection $scope, bool $includeNightowl, ?string $environment, string $sort, string $direction, int $limit, ?string $search = null, ?string $connection = null): array
    {
        $nightowl = $scope->firstWhere('connector', 'nightowl');
        $external = $connection === null ? self::external($scope) : collect();

        $legacy = $includeNightowl
            ? $this->legacy->queries($window, $environment, $sort, $direction, $limit, $search, $connection) : [];

        if ($nightowl !== null) {
            $legacy = array_map(fn (array $row): array => [
                ...$row,
                'project' => $nightowl->project,
                'service' => Sources::key($nightowl),
                'service_label' => $nightowl->label,
            ], $legacy);
        }

        return Telemetry::sortRows([
            ...$legacy, ...$this->external->queryRows($window, $external, $search, $sort, $direction, $limit),
        ], $sort, $direction, $limit);
    }

    public function series(Window $window, Collection $scope, bool $includeNightowl, ?string $environment, ?string $connection): array
    {
        $legacy = $includeNightowl
            ? $this->legacy->querySeries($window, $environment, $connection) : [];
        $external = $connection === null ? $this->external->querySeries($window, self::external($scope)) : [];

        if ($legacy === [] || $external === []) {
            return $legacy ?: $external;
        }

        return array_map(function (array $nightowl, array $otlp): array {
            if ($nightowl['calls'] === 0 || $otlp['calls'] === 0) {
                return $nightowl['calls'] === 0 ? $otlp : $nightowl;
            }

            $calls = $nightowl['calls'] + $otlp['calls'];
            $avg = ($nightowl['avg_ms'] * $nightowl['calls'] + $otlp['avg_ms'] * $otlp['calls']) / $calls;

            // The backends use different distributions. A percentile of percentiles would be misleading.
            return ['t' => $nightowl['t'], 'calls' => $calls, 'avg_ms' => round($avg, 1), 'p95_ms' => null];
        }, $legacy, $external);
    }

    public static function includesNightowl(Collection $scope, ?string $project, ?string $service): bool
    {
        return $scope->contains('connector', 'nightowl') || (! Sources::enabled() && $project === null && $service === null);
    }

    public static function external(Collection $scope): Collection
    {
        return $scope->where('connector', 'otlp')->values();
    }
}
