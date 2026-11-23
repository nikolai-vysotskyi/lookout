<?php

namespace Lookout\Services;

use Illuminate\Database\Query\Builder;
use Lookout\Models\Issue;

/**
 * Drill-downs of the Lookout sections: one group (job class, command, scheduled task, mailable, notification,
 * outgoing host, exception fingerprint) as totals + series from its rollups and its latest instances from the raw
 * tables (~14 days), and one job attempt / command run / scheduled run with the events of its execution.
 */
class Details
{
    private const INSTANCES = 50;

    public function __construct(private Rollups $rollups, private Raw $raw) {}

    /**
     * @return array<string, mixed>|null
     */
    public function job(string $groupHash, Window $window, ?string $environment): ?array
    {
        $selects = ['max(job_class) as job_class', 'max(queue) as queue', 'sum(attempts_count) as attempts', 'sum(queued_count) as queued',
            'sum(processed_count) as processed', 'sum(released_count) as released', 'sum(failed_count) as failed', ...Rollups::durationSelects()];
        $map = fn (?object $r): array => ['queued' => (int) ($r->queued ?? 0), 'attempts' => (int) ($r->attempts ?? 0), 'processed' => (int) ($r->processed ?? 0),
            'released' => (int) ($r->released ?? 0), 'failed' => (int) ($r->failed ?? 0),
            'avg_ms' => isset($r->total_duration) ? Rollups::avg($r, 'attempts') : null, 'p95_ms' => isset($r->total_duration) ? Rollups::p95($r) : null];

        $rows = $this->instances('nightowl_jobs_v2', $groupHash, $window, $environment,
            ['job_id', 'attempt_id', 'attempt', 'duration', 'user_id', 'exception_preview', 'execution_preview', 'trace_id', 'execution_id'],
            ['job_class_id' => 'job_class', 'queue_id' => 'queue', 'connection_id' => 'connection', 'status_id' => 'status', 'execution_source_id' => 'source']);

        return $this->group('nightowl_job_rollups', $groupHash, $window, $environment, $selects, $map, $rows, fn (object $r): array => [
            'job_id' => $r->job_id, 'attempt_id' => $r->attempt_id, 'attempt' => $r->attempt !== null ? (int) $r->attempt : null, 'status' => $r->status,
            'queue' => $r->queue, 'connection' => $r->connection, 'duration_ms' => Rollups::ms($r->duration), 'user_id' => $r->user_id ?: null,
            'exception_preview' => $r->exception_preview, 'source' => $r->source, 'execution_preview' => $r->execution_preview,
            'parent_execution_id' => $r->execution_id, 'trace_id' => $r->trace_id,
        ], fn (object $t): array => ['job' => $t->job_class ?? null, 'queue' => $t->queue ?? null]);
    }

    /**
     * One attempt with every attempt of the same job and the events of its execution (keyed by attempt_id).
     *
     * @return array<string, mixed>|null
     */
    public function jobAttempt(string $attemptId): ?array
    {
        $query = $this->raw->db()->table('nightowl_jobs_v2 as e')->where('e.attempt_id', $attemptId)->orderByDesc('e.created_at')->limit(1)->select('e.*');
        foreach (['job_class_id' => 'job_class', 'queue_id' => 'queue', 'connection_id' => 'connection', 'status_id' => 'status', 'execution_source_id' => 'source', 'environment_id' => 'environment', 'server_id' => 'server'] as $column => $as) {
            $this->raw->dict($query, 'e', $column, $as);
        }
        $row = $query->first();
        if ($row === null) {
            return null;
        }

        $attempts = $row->job_id === null ? collect() : $this->raw->db()->table('nightowl_jobs_v2 as e')->where('e.job_id', $row->job_id)
            ->whereBetween('e.created_at', [self::shift($row->created_at, -86400), self::shift($row->created_at, 86400)])
            ->orderBy('e.attempt')->limit(100)->select(['e.attempt_id', 'e.attempt', 'e.created_at', 'e.duration'])
            ->tap(fn (Builder $q) => $this->raw->dict($q, 'e', 'status_id', 'status'))->get();

        $names = $row->user_id !== null && $row->user_id !== '' ? $this->raw->userNames([(string) $row->user_id]) : [];

        return [
            'attempt' => [
                'attempt_id' => $row->attempt_id, 'job_id' => $row->job_id, 'attempt' => $row->attempt !== null ? (int) $row->attempt : null,
                'job' => $row->job_class, 'queue' => $row->queue, 'connection' => $row->connection, 'status' => $row->status,
                'created_at' => Raw::iso($row->created_at), 'duration_ms' => Rollups::ms($row->duration), 'user_id' => $row->user_id ?: null,
                'user_name' => $names[(string) $row->user_id]['name'] ?? null,
                'environment' => $row->environment, 'server' => $row->server, 'peak_memory_bytes' => $row->peak_memory_usage !== null ? (int) $row->peak_memory_usage : null,
                'exception_preview' => $row->exception_preview, 'group_hash' => Raw::hex($row->group_hash),
                'parent' => ['source' => $row->source, 'execution_id' => $row->execution_id, 'preview' => $row->execution_preview, 'trace_id' => $row->trace_id],
                'counts' => self::counts($row),
            ],
            'attempts' => $attempts->map(fn (object $a): array => ['attempt_id' => $a->attempt_id, 'attempt' => (int) $a->attempt, 'status' => $a->status,
                'created_at' => Raw::iso($a->created_at), 'duration_ms' => Rollups::ms($a->duration)])->all(),
            'events' => $this->raw->events((string) $row->attempt_id, (int) $row->ts_us, (string) $row->created_at),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function command(string $groupHash, Window $window, ?string $environment): ?array
    {
        $selects = ['max(command) as command', 'sum(call_count) as calls', 'sum(successful_count) as successful', 'sum(unsuccessful_count) as failed', ...Rollups::durationSelects()];
        $rows = $this->instances('nightowl_commands_v2', $groupHash, $window, $environment, ['name', 'command', 'exit_code', 'duration', 'exception_preview', 'trace_id'], []);

        return $this->group('nightowl_command_rollups', $groupHash, $window, $environment, $selects, self::runMap('successful'), $rows, fn (object $r): array => [
            'name' => $r->name, 'command' => $r->command, 'exit_code' => $r->exit_code !== null ? (int) $r->exit_code : null,
            'duration_ms' => Rollups::ms($r->duration), 'exception_preview' => $r->exception_preview, 'trace_id' => $r->trace_id,
        ], fn (object $t): array => ['command' => $t->command ?? null]);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function scheduledTask(string $groupHash, Window $window, ?string $environment): ?array
    {
        $selects = ['max(command) as command', 'max(expression) as expression', 'sum(call_count) as calls', 'sum(processed_count) as successful',
            'sum(failed_count) as failed', 'sum(skipped_count) as skipped', ...Rollups::durationSelects()];
        $rows = $this->instances('nightowl_scheduled_tasks_v2', $groupHash, $window, $environment,
            ['command', 'expression', 'timezone', 'exit_code', 'duration', 'exception_preview', 'trace_id', 'without_overlapping', 'on_one_server', 'run_in_background'], ['status_id' => 'status']);

        return $this->group('nightowl_scheduled_task_rollups', $groupHash, $window, $environment, $selects,
            fn (?object $r): array => [...self::runMap('successful')($r), 'skipped' => (int) ($r->skipped ?? 0)], $rows, fn (object $r): array => [
                'status' => $r->status, 'exit_code' => $r->exit_code !== null ? (int) $r->exit_code : null, 'duration_ms' => Rollups::ms($r->duration),
                'exception_preview' => $r->exception_preview, 'trace_id' => $r->trace_id,
            ], fn (object $t): array => ['command' => $t->command ?? null, 'expression' => $t->expression ?? null, 'next_run_at' => Telemetry::nextRun($t->expression ?? null)]);
    }

    /**
     * One command or scheduled-task run with the events of its trace, by row id or by its trace uuid (the
     * execution_id that logs, queries and exceptions of the run carry).
     *
     * @param  'command'|'scheduled_task'  $kind
     * @return array<string, mixed>|null
     */
    public function run(string $kind, int|string $id): ?array
    {
        $table = $kind === 'command' ? 'nightowl_commands_v2' : 'nightowl_scheduled_tasks_v2';
        $query = $this->raw->db()->table("{$table} as e")->limit(1)->select('e.*');
        ctype_digit((string) $id) ? $query->where('e.id', (int) $id) : $query->where('e.trace_id', $id)->orderByDesc('e.created_at');
        $this->raw->dict($query, 'e', 'environment_id', 'environment');
        $this->raw->dict($query, 'e', 'server_id', 'server');
        $row = $query->first();
        if ($row === null) {
            return null;
        }

        return [
            'run' => [
                'id' => (int) $row->id, 'kind' => $kind, 'command' => $row->command, 'name' => $row->name ?? null, 'expression' => $row->expression ?? null,
                'created_at' => Raw::iso($row->created_at), 'duration_ms' => Rollups::ms($row->duration), 'exit_code' => $row->exit_code !== null ? (int) $row->exit_code : null,
                'environment' => $row->environment, 'server' => $row->server, 'exception_preview' => $row->exception_preview, 'trace_id' => $row->trace_id,
                'group_hash' => Raw::hex($row->group_hash), 'counts' => self::counts($row),
            ],
            'events' => $row->trace_id !== null ? $this->raw->events((string) $row->trace_id, (int) $row->ts_us, (string) $row->created_at) : [],
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function mail(string $groupHash, Window $window, ?string $environment): ?array
    {
        $selects = ['max(mailable) as mailable', 'sum(call_count) as calls', 'sum(queued_count) as queued', 'sum(failed_count) as failed', ...Rollups::durationSelects()];
        $rows = $this->instances('nightowl_mail_v2', $groupHash, $window, $environment,
            ['mailer', 'subject', 'recipients', 'cc', 'bcc', 'attachments', 'duration', 'queued', 'failed', 'execution_id', 'execution_preview', 'trace_id', 'user_id'], ['execution_source_id' => 'source']);

        return $this->group('nightowl_mail_rollups', $groupHash, $window, $environment, $selects, self::sendMap(), $rows, fn (object $r): array => [
            'subject' => $r->subject, 'driver' => $r->mailer, 'to' => $r->recipients, 'cc' => (int) $r->cc, 'bcc' => (int) $r->bcc,
            'attachments' => (int) $r->attachments, 'duration_ms' => Rollups::ms($r->duration), 'queued' => (bool) $r->queued, 'failed' => (bool) $r->failed,
            'source' => $r->source, 'execution_id' => $r->execution_id, 'execution_preview' => $r->execution_preview, 'trace_id' => $r->trace_id, 'user_id' => $r->user_id ?: null,
        ], fn (object $t): array => ['mailable' => $t->mailable ?? null]);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function notification(string $groupHash, Window $window, ?string $environment): ?array
    {
        $selects = ['max(notification) as notification', 'sum(call_count) as calls', 'sum(queued_count) as queued', 'sum(failed_count) as failed', ...Rollups::durationSelects()];
        $rows = $this->instances('nightowl_notifications_v2', $groupHash, $window, $environment,
            ['notification', 'notifiable_type', 'notifiable_id', 'duration', 'queued', 'failed', 'execution_id', 'execution_preview', 'trace_id', 'user_id'],
            ['channel_id' => 'channel', 'execution_source_id' => 'source']);

        return $this->group('nightowl_notification_rollups', $groupHash, $window, $environment, $selects, self::sendMap(), $rows, fn (object $r): array => [
            'channel' => $r->channel, 'notifiable_type' => $r->notifiable_type, 'notifiable_id' => $r->notifiable_id, 'duration_ms' => Rollups::ms($r->duration),
            'queued' => (bool) $r->queued, 'failed' => (bool) $r->failed, 'source' => $r->source, 'execution_id' => $r->execution_id,
            'execution_preview' => $r->execution_preview, 'trace_id' => $r->trace_id, 'user_id' => $r->user_id ?: null,
        ], fn (object $t): array => ['notification' => $t->notification ?? null]);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function outgoing(string $groupHash, Window $window, ?string $environment): ?array
    {
        $selects = ['max(host) as host', 'sum(call_count) as calls', 'sum(client_error_count) as client_errors', 'sum(server_error_count) as server_errors', ...Rollups::durationSelects()];
        $rows = $this->instances('nightowl_outgoing_requests_v2', $groupHash, $window, $environment,
            ['url', 'status_code', 'duration', 'request_size', 'response_size', 'execution_id', 'execution_preview', 'trace_id', 'user_id'], ['method_id' => 'method', 'execution_source_id' => 'source']);

        return $this->group('nightowl_outgoing_request_rollups', $groupHash, $window, $environment, $selects, fn (?object $r): array => [
            'calls' => (int) ($r->calls ?? 0), 'status_4xx' => (int) ($r->client_errors ?? 0), 'status_5xx' => (int) ($r->server_errors ?? 0),
            'avg_ms' => isset($r->total_duration) ? Rollups::avg($r) : null, 'p95_ms' => isset($r->total_duration) ? Rollups::p95($r) : null,
        ], $rows, fn (object $r): array => [
            'method' => $r->method, 'url' => $r->url, 'status_code' => $r->status_code !== null ? (int) $r->status_code : null, 'duration_ms' => Rollups::ms($r->duration),
            'request_size' => $r->request_size !== null ? (int) $r->request_size : null, 'response_size' => $r->response_size !== null ? (int) $r->response_size : null,
            'source' => $r->source, 'execution_id' => $r->execution_id, 'execution_preview' => $r->execution_preview, 'trace_id' => $r->trace_id, 'user_id' => $r->user_id ?: null,
        ], fn (object $t): array => ['host' => $t->host ?? null]);
    }

    /**
     * One normalised query: totals and series from its rollups, its latest executions from the raw table with the
     * request/job/command that ran it.
     *
     * @return array<string, mixed>|null
     */
    public function query(string $groupHash, Window $window, ?string $environment): ?array
    {
        $selects = ['max(sql_query) as sql_query', 'max(connection) as connection', 'sum(call_count) as calls', ...Rollups::durationSelects()];
        $rows = $this->instances('nightowl_queries_v2', $groupHash, $window, $environment,
            ['duration', 'user_id', 'trace_id', 'execution_id', 'execution_preview', 'sql_id'], ['connection_id' => 'connection', 'execution_source_id' => 'source']);

        return $this->group('nightowl_query_rollups', $groupHash, $window, $environment, $selects, fn (?object $r): array => [
            'calls' => (int) ($r->calls ?? 0),
            'avg_ms' => isset($r->total_duration) ? Rollups::avg($r) : null,
            'p95_ms' => isset($r->total_duration) ? Rollups::p95($r) : null,
            'max_ms' => Rollups::ms($r->max_duration ?? null),
        ], $rows, fn (object $r): array => [
            'duration_ms' => Rollups::ms($r->duration), 'connection' => $r->connection, 'source' => $r->source, 'execution_id' => $r->execution_id,
            'execution_preview' => $r->execution_preview, 'trace_id' => $r->trace_id, 'user_id' => $r->user_id ?: null,
        ], fn (object $t): array => ['sql' => $t->sql_query ?? null, 'connection' => $t->connection ?? null]);
    }

    /**
     * Unique exceptions (fingerprints) of the window with counts, users and their issue.
     *
     * @return list<array<string, mixed>>
     */
    public function exceptions(Window $window, ?string $environment, string $sort, string $direction, int $limit, ?string $search, bool $unhandledOnly): array
    {
        $rows = $this->rollups->grouped('nightowl_exception_rollups', $window, $environment, ['fingerprint'],
            ['sum(call_count) as total', 'sum(handled_count) as handled', 'sum(unhandled_count) as unhandled', 'min(bucket_start) as first_bucket', 'max(bucket_start) as last_bucket'],
            'sum(call_count) desc', Telemetry::CANDIDATES, $unhandledOnly ? fn (Builder $q) => $q->havingRaw('sum(unhandled_count) > 0') : null);
        $issues = Issue::query()->where('type', 'exception')->whereIn('group_hash', array_map(fn (object $r) => $r->fingerprint, $rows))
            ->when($environment !== null, fn ($q) => $q->where('environment', $environment))->get()->keyBy('group_hash');

        $result = [];
        foreach ($rows as $r) {
            $issue = $issues[$r->fingerprint] ?? null;
            $title = $issue?->exception_class;
            if ($search !== null && $search !== '' && stripos(($title ?? '').' '.($issue?->exception_message ?? ''), $search) === false) {
                continue;
            }
            $result[] = [
                'fingerprint' => $r->fingerprint, 'class' => $title, 'message' => $issue?->exception_message, 'issue_id' => $issue?->id,
                'issue_status' => $issue?->status, 'count' => (int) $r->total, 'handled' => (int) $r->handled, 'unhandled' => (int) $r->unhandled,
                'users' => (int) ($issue->users_count ?? 0),
                'first_seen_at' => $issue ? Raw::iso($issue->getRawOriginal('first_seen_at')) : Raw::iso($r->first_bucket),
                'last_seen_at' => $issue ? Raw::iso($issue->getRawOriginal('last_seen_at')) : Raw::iso($r->last_bucket),
            ];
        }

        return Telemetry::sortRows($result, $sort, $direction, $limit);
    }

    /**
     * Counts over the last 24h / 7d / 30d of one fingerprint (from the rollups, independent of the window).
     *
     * @return array{count_24h: int, count_7d: int, count_30d: int}
     */
    public function exceptionCounts(string $fingerprint, ?string $environment): array
    {
        $counts = [];
        foreach (['count_24h' => '24h', 'count_7d' => '7d', 'count_30d' => '30d'] as $key => $period) {
            $counts[$key] = (int) ($this->rollups->query('nightowl_exception_rollups', Window::period($period), $environment)
                ->where('fingerprint', $fingerprint)->sum('call_count'));
        }

        return $counts;
    }

    /**
     * Totals, series and latest raw instances of one rollup group; null when the group has nothing in the window.
     *
     * @param  list<string>  $selects
     * @param  callable(?object): array<string, mixed>  $map
     * @param  list<object>  $rows
     * @param  callable(object): array<string, mixed>  $instance
     * @param  callable(object): array<string, mixed>  $identity
     * @return array<string, mixed>|null
     */
    private function group(string $table, string $groupHash, Window $window, ?string $environment, array $selects, callable $map, array $rows, callable $instance, callable $identity): ?array
    {
        $scope = fn (Builder $q) => $q->where('group_hash', $groupHash);
        $totals = $this->rollups->totals($table, $window, $environment, $selects, $scope);
        $calls = (int) ($totals->calls ?? $totals->attempts ?? 0);

        if ($calls === 0 && $rows === []) {
            return null;
        }

        return [
            'window' => $window->toArray(),
            'group' => ['group_hash' => $groupHash, ...$identity($totals), ...$map($calls > 0 ? $totals : null)],
            'series' => $this->rollups->series($table, $window, $environment, $selects, $map, $scope),
            'instances' => array_map(fn (object $r): array => ['id' => (int) $r->id, 'created_at' => Raw::iso($r->created_at), ...$instance($r)], $rows),
        ];
    }

    /**
     * Latest raw rows of one group in the window (clamped to the raw retention).
     *
     * @param  list<string>  $columns
     * @param  array<string, string>  $dicts  id column => alias
     * @return list<object>
     */
    private function instances(string $table, string $groupHash, Window $window, ?string $environment, array $columns, array $dicts): array
    {
        $window = $window->raw();
        $query = $this->raw->db()->table("{$table} as e")
            ->whereRaw("e.group_hash = decode(?, 'hex')", [$groupHash])
            ->where('e.created_at', '>=', $window->fromSql())->where('e.created_at', '<', $window->toSql())
            ->orderByDesc('e.created_at')->limit(self::INSTANCES)
            ->select(array_merge(['e.id', 'e.created_at'], array_map(fn (string $c): string => "e.{$c}", $columns)));
        foreach ($dicts as $column => $as) {
            $this->raw->dict($query, 'e', $column, $as);
        }
        $this->raw->scopeEnvironment($query, $environment, 'e.environment_id');

        return $query->get()->all();
    }

    /**
     * @return callable(?object): array<string, mixed>
     */
    private static function runMap(string $okColumn): callable
    {
        return fn (?object $r): array => ['calls' => (int) ($r->calls ?? 0), 'successful' => (int) ($r->{$okColumn} ?? 0), 'failed' => (int) ($r->failed ?? 0),
            'avg_ms' => isset($r->total_duration) ? Rollups::avg($r) : null, 'p95_ms' => isset($r->total_duration) ? Rollups::p95($r) : null];
    }

    /**
     * @return callable(?object): array<string, mixed>
     */
    private static function sendMap(): callable
    {
        return fn (?object $r): array => ['calls' => (int) ($r->calls ?? 0), 'queued' => (int) ($r->queued ?? 0), 'failed' => (int) ($r->failed ?? 0),
            'avg_ms' => isset($r->total_duration) ? Rollups::avg($r) : null, 'p95_ms' => isset($r->total_duration) ? Rollups::p95($r) : null];
    }

    /**
     * @return array<string, int>
     */
    private static function counts(object $row): array
    {
        $keys = ['queries', 'cache_events', 'outgoing_requests', 'logs', 'exceptions', 'jobs_queued', 'mail', 'notifications'];

        return array_combine($keys, array_map(fn (string $c): int => (int) ($row->{$c} ?? 0), $keys));
    }

    private static function shift(string $timestamp, int $seconds): string
    {
        return gmdate('Y-m-d H:i:s', strtotime($timestamp.' UTC') + $seconds);
    }
}
