<?php

namespace Lookout\Services;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Lookout\Lookout;

/**
 * Reads the agent's raw per-event tables (nightowl_*_v2, daily partitions, ~14 days). Dictionary ids resolve through
 * nightowl_dict_string / _dict_route / _dict_sql. Events of one request share its trace_id as their execution_id
 * (and trace_id when the agent links executions). Every read is bounded by created_at and a LIMIT.
 */
class Raw
{
    /** Timestamps (ts_us) and durations are microseconds. */
    private const STAGES = ['bootstrap', 'before_middleware', 'action', 'render', 'after_middleware', 'sending', 'terminating'];

    private const EVENT_LIMIT = 1000;

    public function db(): ConnectionInterface
    {
        return DB::connection(Lookout::connection());
    }

    /**
     * @return list<string>
     */
    public function environments(): array
    {
        return $this->db()->table('nightowl_dict_string')->where('kind', 'environment')->orderBy('value')->pluck('value')->all();
    }

    public function scopeEnvironment(Builder $query, ?string $environment, string $column = 'environment_id'): void
    {
        if ($environment !== null) {
            $query->whereIn($column, fn (Builder $q) => $q->from('nightowl_dict_string')->select('id')->where('kind', 'environment')->where('value', $environment));
        }
    }

    /**
     * Adds "<alias>.value as <as>" for a dictionary id column.
     */
    public function dict(Builder $query, string $table, string $column, string $as): void
    {
        $alias = 'd_'.$as;
        $query->leftJoin("nightowl_dict_string as {$alias}", "{$alias}.id", '=', "{$table}.{$column}")->addSelect("{$alias}.value as {$as}");
    }

    /**
     * 3xx per bucket. The rollups only count < 400 together, so 3xx comes from raw rows: null beyond 7 days.
     *
     * @return array<string, int>|null
     */
    public function redirectsByBucket(Window $window, ?string $environment): ?array
    {
        if ($window->seconds() > 7 * 86400) {
            return null;
        }

        $query = $this->db()->table('nightowl_requests_v2')
            ->where('created_at', '>=', $window->fromSql())->where('created_at', '<', $window->toSql())
            ->whereBetween('status_code', [300, 399])
            ->selectRaw($window->bucketExpression('created_at').' as bucket, count(*) as n')
            ->groupByRaw('1');
        $this->scopeEnvironment($query, $environment);

        $result = [];
        foreach ($query->get() as $row) {
            $result[gmdate('Y-m-d\TH:i:s\Z', strtotime($row->bucket.' UTC'))] = (int) $row->n;
        }

        return $result;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function recentRequests(Window $window, ?string $environment, string $groupHash, int $limit): array
    {
        $window = $window->raw();
        $query = $this->db()->table('nightowl_requests_v2 as r')
            ->whereRaw("r.group_hash = decode(?, 'hex')", [$groupHash])
            ->where('r.created_at', '>=', $window->fromSql())->where('r.created_at', '<', $window->toSql())
            ->orderByDesc('r.created_at')->limit($limit)
            ->select(['r.id', 'r.trace_id', 'r.created_at', 'r.url', 'r.status_code', 'r.duration', 'r.user_id', 'r.queries', 'r.exceptions']);
        $this->dict($query, 'r', 'method_id', 'method');
        $this->scopeEnvironment($query, $environment, 'r.environment_id');

        $rows = $query->get();
        $names = $this->userNamesOf($rows);

        return $rows->map(fn (object $r): array => [
            'id' => (int) $r->id,
            'trace_id' => $r->trace_id,
            'created_at' => self::iso($r->created_at),
            'method' => $r->method,
            'url' => $r->url,
            'status_code' => $r->status_code !== null ? (int) $r->status_code : null,
            'duration_ms' => Rollups::ms($r->duration),
            'user_id' => $r->user_id ?: null,
            'user_name' => $names[(string) $r->user_id] ?? null,
            'queries' => (int) $r->queries,
            'exceptions' => (int) $r->exceptions,
        ])->all();
    }

    /**
     * One request with its stage timings and every event of its execution, offsets relative to the request start.
     *
     * @return array<string, mixed>|null
     */
    public function request(string $idOrTrace): ?array
    {
        $query = $this->db()->table('nightowl_requests_v2 as r')
            ->leftJoin('nightowl_dict_route as route', 'route.id', '=', 'r.route_id')
            ->select(['r.*', 'route.path as route_path', 'route.name as route_name', 'route.action as route_action', 'route.methods as route_methods'])
            ->limit(1);
        $this->dict($query, 'r', 'method_id', 'method');
        $this->dict($query, 'r', 'environment_id', 'environment');
        $this->dict($query, 'r', 'server_id', 'server');
        $this->dict($query, 'r', 'deploy_id', 'deploy');

        if (ctype_digit($idOrTrace)) {
            $query->where('r.id', (int) $idOrTrace);
        } else {
            $query->where('r.trace_id', $idOrTrace)->orderByDesc('r.created_at');
        }

        $r = $query->first();
        if ($r === null) {
            return null;
        }

        $stages = [];
        $offset = 0;
        foreach (self::STAGES as $stage) {
            $us = $r->{$stage} !== null ? (int) $r->{$stage} : null;
            $stages[] = ['name' => $stage, 'offset_ms' => Rollups::ms($offset), 'duration_ms' => Rollups::ms($us)];
            $offset += $us ?? 0;
        }

        $names = $this->userNamesOf([$r]);

        return [
            'request' => [
                'id' => (int) $r->id,
                'trace_id' => $r->trace_id,
                'created_at' => self::iso($r->created_at),
                'method' => $r->method,
                'url' => $r->url,
                'route' => ['path' => $r->route_path, 'name' => $r->route_name, 'action' => $r->route_action, 'group_hash' => self::hex($r->group_hash)],
                'status_code' => $r->status_code !== null ? (int) $r->status_code : null,
                'duration_ms' => Rollups::ms($r->duration),
                'user_id' => $r->user_id ?: null,
                'user_name' => $names[(string) $r->user_id] ?? null,
                'ip' => $r->ip,
                'environment' => $r->environment,
                'server' => $r->server,
                'deploy' => $r->deploy,
                'request_size' => $r->request_size !== null ? (int) $r->request_size : null,
                'response_size' => $r->response_size !== null ? (int) $r->response_size : null,
                'peak_memory_bytes' => $r->peak_memory_usage !== null ? (int) $r->peak_memory_usage : null,
                'exception_preview' => $r->exception_preview,
                'headers' => self::inflate($r->headers_z ?? null),
                'payload' => self::inflate($r->payload_z ?? null),
                'response_body' => self::inflate($r->response_z ?? null),
                'counts' => array_combine(
                    ['queries', 'cache_events', 'outgoing_requests', 'logs', 'exceptions', 'jobs_queued', 'mail', 'notifications'],
                    array_map(fn (string $c): int => (int) $r->{$c}, ['queries', 'cache_events', 'outgoing_requests', 'logs', 'exceptions', 'jobs_queued', 'mail', 'notifications']),
                ),
                'stages' => $stages,
            ],
            'events' => $r->trace_id !== null ? $this->events((string) $r->trace_id, (int) $r->ts_us, (string) $r->created_at) : [],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function events(string $traceId, int $startUs, string $createdAt): array
    {
        $from = date('Y-m-d H:i:s', strtotime($createdAt.' UTC') - 60);
        $to = date('Y-m-d H:i:s', strtotime($createdAt.' UTC') + 900);
        $base = function (string $table, array $columns) use ($traceId, $from, $to): Builder {
            $q = $this->db()->table("{$table} as e")
                ->where(fn (Builder $w) => $w->where('e.execution_id', $traceId)->orWhere('e.trace_id', $traceId))
                ->whereBetween('e.created_at', [$from, $to])
                ->orderBy('e.ts_us')->limit(self::EVENT_LIMIT)
                ->select(array_merge(['e.id', 'e.ts_us', 'e.execution_id'], array_map(fn (string $c): string => "e.{$c}", $columns)));
            $this->dict($q, 'e', 'execution_stage_id', 'stage');

            return $q;
        };
        $event = fn (string $type, object $row, array $fields): array => [
            'type' => $type,
            'id' => (int) $row->id,
            'offset_ms' => Rollups::ms((int) $row->ts_us - $startUs),
            'duration_ms' => isset($row->duration) ? Rollups::ms($row->duration) : null,
            'stage' => $row->stage,
            'same_execution' => $row->execution_id === $traceId,
            ...$fields,
        ];
        $events = [];

        $q = $base('nightowl_queries_v2', ['duration', 'sql_id', 'group_hash'])->leftJoin('nightowl_dict_sql as s', 's.id', '=', 'e.sql_id')->addSelect(['s.sql', 's.file', 's.line']);
        $this->dict($q, 'e', 'connection_id', 'connection');
        foreach ($q->get() as $row) {
            $events[] = $event('query', $row, ['sql' => $row->sql, 'sql_id' => $row->sql_id !== null ? (int) $row->sql_id : null,
                'connection' => $row->connection, 'file' => $row->file, 'line' => $row->line !== null ? (int) $row->line : null, 'group_hash' => self::hex($row->group_hash)]);
        }

        $q = $base('nightowl_cache_events_v2', ['duration', 'key', 'ttl']);
        $this->dict($q, 'e', 'event_type_id', 'event_type');
        $this->dict($q, 'e', 'store_id', 'store');
        foreach ($q->get() as $row) {
            $events[] = $event('cache', $row, ['event' => $row->event_type, 'key' => $row->key, 'store' => $row->store, 'ttl' => $row->ttl]);
        }

        $q = $base('nightowl_outgoing_requests_v2', ['duration', 'url', 'status_code', 'group_hash']);
        $this->dict($q, 'e', 'method_id', 'method');
        $this->dict($q, 'e', 'host_id', 'host');
        foreach ($q->get() as $row) {
            $events[] = $event('outgoing_request', $row, ['method' => $row->method, 'host' => $row->host, 'url' => $row->url,
                'status_code' => $row->status_code !== null ? (int) $row->status_code : null, 'group_hash' => self::hex($row->group_hash)]);
        }

        $q = $base('nightowl_logs_v2', ['message', 'context', 'context_z']);
        $this->dict($q, 'e', 'level_id', 'level');
        $this->dict($q, 'e', 'channel_id', 'channel');
        foreach ($q->get() as $row) {
            $events[] = $event('log', $row, ['level' => $row->level, 'channel' => $row->channel, 'message' => $row->message,
                'context' => self::context($row->context, $row->context_z)]);
        }

        $q = $base('nightowl_exceptions_v2', ['class', 'message', 'file', 'line', 'handled', 'fingerprint']);
        foreach ($q->get() as $row) {
            $events[] = $event('exception', $row, ['class' => $row->class, 'message' => $row->message, 'file' => $row->file,
                'line' => $row->line !== null ? (int) $row->line : null, 'handled' => (bool) $row->handled, 'fingerprint' => self::hex($row->fingerprint)]);
        }

        $q = $base('nightowl_jobs_v2', ['duration', 'attempt']);
        $this->dict($q, 'e', 'job_class_id', 'job_class');
        $this->dict($q, 'e', 'queue_id', 'queue');
        $this->dict($q, 'e', 'status_id', 'status');
        foreach ($q->get() as $row) {
            $events[] = $event('job', $row, ['job' => $row->job_class, 'queue' => $row->queue, 'status' => $row->status,
                'attempt' => $row->attempt !== null ? (int) $row->attempt : null]);
        }

        foreach ($base('nightowl_mail_v2', ['duration', 'mailable', 'subject', 'queued', 'failed'])->get() as $row) {
            $events[] = $event('mail', $row, ['mailable' => $row->mailable, 'subject' => $row->subject, 'queued' => (bool) $row->queued, 'failed' => (bool) $row->failed]);
        }

        $q = $base('nightowl_notifications_v2', ['duration', 'notification', 'notifiable_type', 'queued', 'failed']);
        $this->dict($q, 'e', 'channel_id', 'channel');
        foreach ($q->get() as $row) {
            $events[] = $event('notification', $row, ['notification' => $row->notification, 'channel' => $row->channel,
                'notifiable_type' => $row->notifiable_type, 'queued' => (bool) $row->queued, 'failed' => (bool) $row->failed]);
        }

        usort($events, fn (array $a, array $b): int => $a['offset_ms'] <=> $b['offset_ms']);

        return $events;
    }

    /** Logs pages stop here: deeper OFFSETs over an unindexed ILIKE scan cost too much. Narrow the window instead. */
    public const LOGS_MAX_OFFSET = 10000;

    /**
     * @return array{logs: list<array<string, mixed>>, levels: list<string>, has_more: bool}
     */
    public function logs(Window $window, ?string $environment, ?string $level, ?string $search, int $limit, int $page, ?string $userId = null): array
    {
        $window = $window->raw();
        $query = $this->db()->table('nightowl_logs_v2 as e')
            ->where('e.created_at', '>=', $window->fromSql())->where('e.created_at', '<', $window->toSql())
            ->orderByDesc('e.created_at')->orderByDesc('e.id')
            ->offset(($page - 1) * $limit)->limit($limit + 1)
            ->select(['e.id', 'e.created_at', 'e.message', 'e.context', 'e.context_z', 'e.extra_z', 'e.user_id', 'e.trace_id', 'e.execution_id', 'e.execution_preview']);
        $this->dict($query, 'e', 'level_id', 'level');
        $this->dict($query, 'e', 'channel_id', 'channel');
        $this->dict($query, 'e', 'execution_source_id', 'source');
        $this->scopeEnvironment($query, $environment, 'e.environment_id');

        if ($level !== null) {
            $query->whereIn('e.level_id', fn (Builder $q) => $q->from('nightowl_dict_string')->select('id')->where('kind', 'level')->where('value', $level));
        }
        if ($userId !== null && $userId !== '') {
            $query->where('e.user_id', $userId);
        }
        if ($search !== null && $search !== '') {
            $query->where('e.message', 'ilike', '%'.addcslashes($search, '%_\\').'%');
        }

        $rows = $query->get();
        $entries = $rows->take($limit);
        $names = $this->userNamesOf($entries);

        return [
            'logs' => $entries->map(fn (object $r): array => [
                'id' => (int) $r->id,
                'created_at' => self::iso($r->created_at),
                'level' => $r->level,
                'channel' => $r->channel,
                'message' => $r->message,
                'context' => self::context($r->context, $r->context_z),
                'extra' => self::inflate($r->extra_z),
                'user_id' => $r->user_id ?: null,
                'user_name' => $names[(string) $r->user_id] ?? null,
                'source' => $r->source,
                'execution_id' => $r->execution_id,
                'trace_id' => $r->trace_id,
                'execution_preview' => $r->execution_preview,
            ])->values()->all(),
            'levels' => $this->db()->table('nightowl_dict_string')->where('kind', 'level')->orderBy('value')->pluck('value')->all(),
            'has_more' => $rows->count() > $limit && $page * $limit <= self::LOGS_MAX_OFFSET,
        ];
    }

    /**
     * The same normalised query run many times inside one execution. Raw rows, so the window is clamped to 24 h.
     *
     * @return array{window: array<string, mixed>, suspects: list<array<string, mixed>>}
     */
    public function nPlusOne(Window $window, ?string $environment, int $minPerExecution, int $limit): array
    {
        $floor = $window->to->subDay();
        $window = $window->from->lt($floor) ? new Window($floor, $window->to, $window->period) : $window;

        $inner = $this->db()->table('nightowl_queries_v2')
            ->where('created_at', '>=', $window->fromSql())->where('created_at', '<', $window->toSql())
            ->whereNotNull('execution_id')->whereNotNull('sql_id')
            ->groupBy('sql_id', 'execution_id')
            ->havingRaw('count(*) >= ?', [$minPerExecution])
            ->selectRaw('sql_id, execution_id, count(*) as c, sum(duration) as d');
        $this->scopeEnvironment($inner, $environment);

        $rows = $this->db()->query()->fromSub($inner, 't')
            ->leftJoin('nightowl_dict_sql as s', 's.id', '=', 't.sql_id')
            ->groupBy('t.sql_id', 's.sql', 's.file', 's.line')
            ->selectRaw('t.sql_id, s.sql, s.file, s.line, count(*) as executions, sum(t.c) as queries, max(t.c) as max_per_execution, sum(t.d) as total_duration, (array_agg(t.execution_id::text order by t.c desc))[1] as sample_execution_id')
            ->orderByRaw('sum(t.c) desc')
            ->limit($limit)
            ->get();

        return [
            'window' => $window->toArray(),
            'suspects' => $rows->map(fn (object $r): array => [
                'sql_id' => (int) $r->sql_id,
                'sql' => $r->sql,
                'file' => $r->file,
                'line' => $r->line !== null ? (int) $r->line : null,
                'executions' => (int) $r->executions,
                'queries' => (int) $r->queries,
                'max_per_execution' => (int) $r->max_per_execution,
                'total_ms' => Rollups::ms($r->total_duration),
                'sample_execution_id' => $r->sample_execution_id,
            ])->all(),
        ];
    }

    /**
     * Latest raw rows of one user in a table (requests, jobs, exceptions), newest first.
     *
     * @param  list<string>  $columns
     * @param  array<string, string>  $dicts  id column => alias
     * @return list<object>
     */
    public function byUser(string $table, string $userId, Window $window, ?string $environment, array $columns, array $dicts, int $limit): array
    {
        $window = $window->raw();
        $query = $this->db()->table("{$table} as e")->where('e.user_id', $userId)
            ->where('e.created_at', '>=', $window->fromSql())->where('e.created_at', '<', $window->toSql())
            ->orderByDesc('e.created_at')->limit($limit)
            ->select(array_merge(['e.id', 'e.created_at'], array_map(fn (string $c): string => "e.{$c}", $columns)));
        foreach ($dicts as $column => $as) {
            $this->dict($query, 'e', $column, $as);
        }
        $this->scopeEnvironment($query, $environment, 'e.environment_id');

        return $query->get()->all();
    }

    /**
     * @param  list<string>  $userIds
     * @return array<string, int>
     */
    public function slowRequestsByUser(Window $window, ?string $environment, array $userIds, int $slowMs): array
    {
        if ($userIds === []) {
            return [];
        }

        $window = $window->raw();
        $query = $this->db()->table('nightowl_requests_v2')
            ->whereIn('user_id', $userIds)
            ->where('created_at', '>=', $window->fromSql())->where('created_at', '<', $window->toSql())
            ->where('duration', '>=', $slowMs * 1000)
            ->groupBy('user_id')
            ->selectRaw('user_id, count(*) as n');
        $this->scopeEnvironment($query, $environment);

        return $query->pluck('n', 'user_id')->map(fn ($n): int => (int) $n)->all();
    }

    /**
     * Names and emails for telemetry user ids: the agent's nightowl_users first, then the app's users table.
     *
     * @param  list<string>  $userIds
     * @return array<string, array{name: ?string, email: ?string}>
     */
    public function userNames(array $userIds): array
    {
        $userIds = array_values(array_unique(array_filter($userIds, fn (string $id): bool => $id !== '')));
        if ($userIds === []) {
            return [];
        }

        $names = [];
        foreach ($this->db()->table('nightowl_users')->whereIn('user_id', $userIds)->get(['user_id', 'name', 'email']) as $row) {
            $names[(string) $row->user_id] = ['name' => $row->name, 'email' => $row->email];
        }

        $missing = array_values(array_filter(array_diff($userIds, array_keys($names)), 'ctype_digit'));
        if ($missing !== []) {
            foreach ((Lookout::userModel())::query()->whereIn('id', array_map('intval', $missing))->get(['id', 'name', 'email']) as $user) {
                $names[(string) $user->id] = ['name' => $user->name, 'email' => $user->email];
            }
        }

        return $names;
    }

    /**
     * The names of the rows' user ids, keyed by id, for the lists that show a user next to each row. One query per
     * response; a row whose id has no user record is left out and the SPA falls back to "User #<id>".
     *
     * @param  iterable<object>  $rows
     * @return array<string, ?string>
     */
    private function userNamesOf(iterable $rows): array
    {
        $ids = [];
        foreach ($rows as $row) {
            if (($row->user_id ?? null) !== null && $row->user_id !== '') {
                $ids[] = (string) $row->user_id;
            }
        }

        return array_map(fn (array $user): ?string => $user['name'], $this->userNames($ids));
    }

    /**
     * A gzdeflate'd JSON blob of the agent (headers_z, payload_z, extra_z, ...) decoded; null when absent or unreadable.
     */
    public static function inflate(mixed $compressed): mixed
    {
        $blob = is_resource($compressed) ? stream_get_contents($compressed) : $compressed;
        if (! is_string($blob) || $blob === '') {
            return null;
        }
        $plain = @gzinflate($blob);
        if ($plain === false) {
            return null;
        }
        $decoded = json_decode($plain, true);

        return json_last_error() === JSON_ERROR_NONE ? $decoded : mb_strimwidth($plain, 0, 16384, '…');
    }

    public static function iso(?string $timestamp): ?string
    {
        return $timestamp !== null ? gmdate('Y-m-d\TH:i:s\Z', strtotime($timestamp.' UTC')) : null;
    }

    public static function hex(mixed $bytea): ?string
    {
        if (is_resource($bytea)) {
            $bytea = stream_get_contents($bytea);
        }

        return is_string($bytea) && $bytea !== '' ? bin2hex($bytea) : null;
    }

    /**
     * Log context, plain or gzdeflate'd (context_z), cut to 4 KB.
     */
    public static function context(?string $plain, mixed $compressed): ?string
    {
        if (($plain === null || $plain === '') && $compressed !== null) {
            $blob = is_resource($compressed) ? stream_get_contents($compressed) : $compressed;
            $plain = is_string($blob) && $blob !== '' ? (@gzinflate($blob) ?: null) : null;
        }

        return $plain !== null ? mb_strimwidth($plain, 0, 4096, '…') : null;
    }
}
