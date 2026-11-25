<?php

namespace Lookout\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;

final class SourceTelemetry
{
    private const QUERY_STATS = 'count(*) as calls, sum(duration_us) as total_us, avg(duration_us) as average_us, max(duration_us) as max_us, percentile_disc(0.95) within group (order by duration_us) as p95_us';

    public function __construct(private Sources $sources) {}

    public function queryRows(Window $window, Collection $services, ?string $search, string $sort, string $direction, int $limit): array
    {
        if ($services->isEmpty()) {
            return [];
        }

        $rows = $this->spans($window, $services)->where('kind', 'query')->whereNotNull('query_fingerprint')
            ->when($search !== null && $search !== '', fn (Builder $query) => $query->whereRaw(
                'lower(coalesce(query_text, name)) like ?', ['%'.mb_strtolower($search).'%']
            ))
            ->selectRaw('source_id, query_fingerprint, max(coalesce(query_text, name)) as sql, '.self::QUERY_STATS)
            ->groupBy('source_id', 'query_fingerprint')
            ->orderBy(match ($sort) {
                'calls' => 'calls',
                'avg_ms' => 'average_us',
                'p95_ms' => 'p95_us',
                'max_ms' => 'max_us',
                default => 'total_us',
            }, $direction)
            ->orderBy('source_id')->orderBy('query_fingerprint')->limit($limit)->get();

        $catalog = $services->keyBy('id');

        return $rows->map(function (object $row) use ($catalog): array {
            $service = $catalog[$row->source_id];

            return [
                'group_hash' => $row->query_fingerprint,
                'source_id' => (int) $row->source_id,
                'project' => $service->project,
                'service' => Sources::key($service),
                'service_label' => $service->label,
                'connection' => null,
                'sql' => $row->sql,
                ...self::stats($row),
            ];
        })->all();
    }

    /**
     * HTTP routes of the OpenTelemetry services (server spans, kind "request"), in the shape of Performance::routes plus
     * the service: calls, 4xx and 5xx counts, error rate (%), average and p95 duration.
     *
     * @return list<array<string, mixed>>
     */
    public function routeRows(Window $window, Collection $services, string $sort, int $limit): array
    {
        if ($services->isEmpty()) {
            return [];
        }

        $rows = $this->spans($window, $services)->where('kind', 'request')
            ->selectRaw('source_id, name, count(*) as calls, avg(duration_us) as average_us, '
                .'percentile_disc(0.95) within group (order by duration_us) as p95_us, '
                .'sum(case when status_code between 400 and 499 then 1 else 0 end) as client_errors, '
                .'sum(case when error then 1 else 0 end) as server_errors')
            ->groupBy('source_id', 'name')
            ->orderByRaw(match ($sort) {
                'calls' => 'calls desc',
                'avg_ms' => 'average_us desc',
                'error_rate' => '(sum(case when status_code between 400 and 499 or error then 1 else 0 end) * 1.0 / count(*)) desc',
                default => 'p95_us desc',
            })
            ->orderBy('source_id')->orderBy('name')->limit($limit)->get();

        $catalog = $services->keyBy('id');

        return $rows->map(function (object $row) use ($catalog): array {
            $service = $catalog[$row->source_id];
            $calls = (int) $row->calls;
            $failed = (int) $row->client_errors + (int) $row->server_errors;

            return [
                'route' => $row->name,
                'calls' => $calls,
                'client_errors' => (int) $row->client_errors,
                'server_errors' => (int) $row->server_errors,
                'error_rate' => $calls > 0 ? round(100 * $failed / $calls, 2) : 0.0,
                'avg_ms' => Rollups::ms($row->average_us),
                'p95_ms' => Rollups::ms($row->p95_us),
                'project' => $service->project,
                'service' => Sources::key($service),
                'service_label' => $service->label,
            ];
        })->all();
    }

    public function queryDetail(Window $window, object $service, string $fingerprint): ?array
    {
        $spans = $this->spans($window, collect([$service]))->where('kind', 'query')->where('query_fingerprint', $fingerprint);
        $group = (clone $spans)->selectRaw('max(coalesce(query_text, name)) as sql, '.self::QUERY_STATS)->first();
        if (! $group->calls) {
            return null;
        }

        $instances = (clone $spans)->latest('started_at')->limit(50)->get(['started_at', 'duration_us', 'trace_id', 'error']);

        return [
            'window' => $window->toArray(),
            'group' => ['sql' => $group->sql, 'service_label' => $service->label, ...self::stats($group)],
            'series' => $this->bucketed($window, $spans),
            'instances' => $instances->map(fn (object $row) => [
                'created_at' => Raw::iso($row->started_at),
                'duration_ms' => Rollups::ms($row->duration_us),
                'execution_preview' => $row->trace_id,
                'error' => (bool) $row->error,
            ])->all(),
        ];
    }

    public function querySeries(Window $window, Collection $services): array
    {
        return $services->isEmpty() ? [] : $this->bucketed($window, $this->spans($window, $services)->where('kind', 'query'));
    }

    public function activity(Window $window, Collection $services): array
    {
        if ($services->isEmpty()) {
            return ['progress' => [], 'errors' => []];
        }

        $catalog = $services->keyBy('id');
        $spans = $this->spans($window, $services);
        $progress = (clone $spans)->where('kind', 'progress')->where('error', false)
            ->selectRaw("source_id, name, max(started_at + duration_us * interval '1 microsecond') as last_success_at")
            ->groupBy('source_id', 'name')->orderByDesc('last_success_at')->limit(100)->get();
        $errors = (clone $spans)->where('error', true)
            ->selectRaw('source_id, name, count(*) as count, max(started_at) as last_seen_at')
            ->groupBy('source_id', 'name')->orderByDesc('last_seen_at')->limit(100)->get();

        return [
            'progress' => $progress->map(fn (object $row): array => [
                'service' => Sources::key($catalog[$row->source_id]),
                'service_label' => $catalog[$row->source_id]->label,
                'operation' => $row->name,
                'last_success_at' => Raw::iso($row->last_success_at),
            ])->all(),
            'errors' => $errors->map(fn (object $row): array => [
                'service' => Sources::key($catalog[$row->source_id]),
                'service_label' => $catalog[$row->source_id]->label,
                'operation' => $row->name,
                'count' => (int) $row->count,
                'last_seen_at' => Raw::iso($row->last_seen_at),
            ])->all(),
        ];
    }

    private function spans(Window $window, Collection $services): Builder
    {
        return $this->sources->reader()->table('lookout_spans')
            ->whereIn('source_id', $services->pluck('id'))
            ->where('started_at', '>=', $window->from->format('Y-m-d H:i:s.u'))
            ->where('started_at', '<', $window->to->format('Y-m-d H:i:s.u'));
    }

    private function bucketed(Window $window, Builder $spans): array
    {
        $bucket = $window->bucketExpression('started_at');
        $rows = $spans->selectRaw($bucket.' as bucket, '.self::QUERY_STATS)->groupByRaw('1')->get()
            ->keyBy(fn (object $row): string => Raw::iso($row->bucket));

        return array_map(fn (string $start): array => ['t' => $start, ...self::stats($rows->get($start))], $window->bucketStarts());
    }

    private static function stats(?object $row): array
    {
        return [
            'calls' => (int) ($row->calls ?? 0),
            'total_ms' => Rollups::ms($row->total_us ?? null),
            'avg_ms' => Rollups::ms($row->average_us ?? null),
            'p95_ms' => Rollups::ms($row->p95_us ?? null),
            'max_ms' => Rollups::ms($row->max_us ?? null),
        ];
    }
}
