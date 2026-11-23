<?php

namespace Lookout\Services;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Lookout\Lookout;
use Lookout\Models\Issue;
use Lookout\Models\IssueActivity;
use Lookout\Models\IssueComment;

/**
 * Issues list and detail. Exception issues are keyed by group_hash = the exception fingerprint, so their occurrence
 * buckets come from nightowl_exception_rollups and their occurrences from nightowl_exceptions_v2. Performance
 * issues have no per-occurrence rows: their buckets are null.
 */
class Issues
{
    public function __construct(private Rollups $rollups, private Raw $raw, private IssueOccurrence $occurrence) {}

    /** Status tabs of the list: the stored statuses plus open issues nobody owns / the viewer owns. */
    public const TABS = ['open', 'unassigned', 'mine', 'resolved', 'ignored', 'all'];

    /**
     * @param  array{status?: string, type?: ?string, priority?: ?string, assignee?: ?string, q?: ?string}  $filters
     * @return array{issues: list<array<string, mixed>>, total: int, page: int, limit: int, counts: array<string, mixed>}
     */
    public function list(Window $window, ?string $environment, array $filters, ?int $viewerId, string $sort, string $direction, int $limit, int $page): array
    {
        $tab = $filters['status'] ?? 'open';
        $type = $filters['type'] ?? null;
        $base = $this->filtered($window, $environment, $filters);

        $query = (clone $base)->where(fn (Builder $q) => $this->tab($q, $tab, $viewerId));
        if ($type !== null) {
            $query->where('type', $type);
        }

        $total = (clone $query)->count();
        $issues = $query->orderBy($sort, $direction)->orderByDesc('id')->offset(($page - 1) * $limit)->limit($limit)->get();
        $sparklines = $this->buckets($window, $environment, $issues->where('type', 'exception')->pluck('group_hash')->filter()->values()->all());
        $assignees = $this->assignees($issues->pluck('assigned_to')->filter()->all());

        $byType = (clone $base)->where(fn (Builder $q) => $this->tab($q, $tab, $viewerId))
            ->toBase()->groupBy('type')->selectRaw('type, count(*) as n')->pluck('n', 'type');
        $typed = (clone $base)->when($type !== null, fn (Builder $q) => $q->where('type', $type));
        $viewer = $viewerId !== null ? (string) $viewerId : '';
        $tabs = (array) $typed->toBase()->selectRaw(
            "count(*) filter (where status = 'open') as open, count(*) filter (where status = 'open' and assigned_to is null) as unassigned, "
            ."count(*) filter (where status = 'open' and assigned_to = ?) as mine, count(*) filter (where status = 'resolved') as resolved, "
            ."count(*) filter (where status = 'ignored') as ignored, count(*) as \"all\"", [$viewer])->first();

        return [
            'issues' => $issues->map(fn (Issue $issue): array => [
                ...$this->summary($issue, $assignees),
                'buckets' => $issue->type === 'exception' ? ($sparklines[$issue->group_hash] ?? null) : null,
            ])->all(),
            'total' => $total,
            'page' => $page,
            'limit' => $limit,
            'counts' => [
                'types' => ['exception' => (int) ($byType['exception'] ?? 0), 'performance' => (int) ($byType['performance'] ?? 0)],
                'statuses' => array_map('intval', $tabs),
            ],
        ];
    }

    /**
     * The window, environment, priority, assignee and search filters, without the tab and type.
     *
     * @param  array{priority?: ?string, assignee?: ?string, q?: ?string}  $filters
     * @return Builder<Issue>
     */
    private function filtered(Window $window, ?string $environment, array $filters): Builder
    {
        $query = Issue::query()->where('last_seen_at', '>=', $window->fromSql());

        if ($environment !== null) {
            $query->where('environment', $environment);
        }
        if (($priority = $filters['priority'] ?? null) !== null) {
            $priority === 'none' ? $query->whereNull('priority') : $query->where('priority', $priority);
        }
        if (($assignee = $filters['assignee'] ?? null) !== null) {
            $query->where('assigned_to', $assignee);
        }
        if (($search = $filters['q'] ?? null) !== null && $search !== '') {
            $term = '%'.addcslashes($search, '%_\\').'%';
            $query->where(fn (Builder $q) => $q->where('exception_class', 'ilike', $term)->orWhere('exception_message', 'ilike', $term)->orWhere('description', 'ilike', $term));
        }

        return $query;
    }

    /**
     * @param  Builder<Issue>  $query
     */
    private function tab(Builder $query, string $tab, ?int $viewerId): void
    {
        match ($tab) {
            'all' => null,
            'unassigned' => $query->where('status', 'open')->whereNull('assigned_to'),
            'mine' => $query->where('status', 'open')->where('assigned_to', (string) ($viewerId ?? '')),
            default => $query->where('status', $tab),
        };
    }

    /**
     * App users behind assigned_to ids.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: int, name: string, email: string}>
     */
    public function assignees(array $ids): array
    {
        $ids = array_values(array_filter(array_unique($ids), 'ctype_digit'));

        return $ids === [] ? [] : (Lookout::userModel())::query()->whereIn('id', array_map('intval', $ids))->get(['id', 'name', 'email'])
            ->mapWithKeys(fn (Model $u): array => [(string) $u->id => ['id' => (int) $u->id, 'name' => $u->name, 'email' => $u->email]])->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function detail(Issue $issue, Window $window): array
    {
        $isException = $issue->type === 'exception' && is_string($issue->group_hash) && preg_match('/^[0-9a-f]{32}$/i', $issue->group_hash) === 1;

        return [
            'window' => $window->toArray(),
            'issue' => $this->summary($issue, $this->assignees(array_filter([$issue->assigned_to]))),
            'latest_occurrence' => $this->occurrence->latest($issue),
            'buckets' => $isException ? ($this->buckets($window, $issue->environment, [$issue->group_hash])[$issue->group_hash] ?? []) : null,
            'recent_occurrences' => $isException ? $this->occurrences($issue, $window) : [],
            'affected_users' => $isException ? $this->affectedUsers($issue, $window) : [],
            'activity' => $issue->activity()->latest('created_at')->limit(50)->get()->map(fn (IssueActivity $a): array => [
                'id' => (int) $a->id,
                'action' => $a->action,
                'old_value' => $a->old_value,
                'new_value' => $a->new_value,
                'actor_type' => $a->actor_type,
                'user_name' => $a->user_name,
                'via' => $a->actor_meta['via'] ?? null,
                'created_at' => Raw::iso($a->getRawOriginal('created_at')),
            ])->all(),
            'comments' => $issue->comments()->orderBy('id')->limit(200)->get()->map(fn (IssueComment $c): array => self::comment($c))->all(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    /**
     * @param  array<string, array{id: int, name: string, email: string}>|null  $assignees  from assignees(); looked up when null
     */
    public function summary(Issue $issue, ?array $assignees = null): array
    {
        $assignees ??= $this->assignees(array_filter([$issue->assigned_to]));

        return [
            'id' => (int) $issue->id,
            'type' => $issue->type,
            'subtype' => $issue->subtype,
            'status' => $issue->status,
            'priority' => $issue->priority,
            'assigned_to' => $issue->assigned_to !== null ? ($assignees[$issue->assigned_to] ?? ['id' => null, 'name' => null, 'email' => null, 'raw' => $issue->assigned_to]) : null,
            'description' => $issue->description,
            'title' => $issue->exception_class ?? $issue->description,
            'message' => $issue->exception_message,
            'group_hash' => $issue->group_hash,
            'environment' => $issue->environment,
            'occurrences' => (int) $issue->occurrences_count,
            'users_affected' => (int) $issue->users_count,
            'threshold_ms' => $issue->threshold_ms,
            'triggered_duration_ms' => $issue->triggered_duration_ms,
            'first_seen_at' => Raw::iso($issue->getRawOriginal('first_seen_at')),
            'last_seen_at' => Raw::iso($issue->getRawOriginal('last_seen_at')),
        ];
    }

    /**
     * @return array{id: int, body: string, user_id: ?string, user_name: ?string, actor_type: string, created_at: ?string, updated_at: ?string}
     */
    public static function comment(IssueComment $comment): array
    {
        return [
            'id' => (int) $comment->id,
            'body' => $comment->body,
            'user_id' => $comment->user_id,
            'user_name' => $comment->user_name,
            'actor_type' => $comment->actor_type,
            'created_at' => Raw::iso($comment->getRawOriginal('created_at')),
            'updated_at' => Raw::iso($comment->getRawOriginal('updated_at')),
        ];
    }

    /**
     * Occurrence counts per bucket for each exception fingerprint.
     *
     * @param  list<string>  $fingerprints
     * @return array<string, list<array{t: string, count: int}>>
     */
    private function buckets(Window $window, ?string $environment, array $fingerprints): array
    {
        if ($fingerprints === []) {
            return [];
        }

        $rows = $this->rollups->query('nightowl_exception_rollups', $window, $environment)
            ->whereIn('fingerprint', $fingerprints)
            ->selectRaw('fingerprint, '.$window->bucketExpression().' as bucket, sum(call_count) as n')
            ->groupByRaw('1, 2')
            ->get();

        $counts = [];
        foreach ($rows as $row) {
            $counts[$row->fingerprint][gmdate('Y-m-d\TH:i:s\Z', strtotime($row->bucket.' UTC'))] = (int) $row->n;
        }

        $starts = $window->bucketStarts();
        $result = [];
        foreach ($fingerprints as $fingerprint) {
            $result[$fingerprint] = array_map(fn (string $t): array => ['t' => $t, 'count' => $counts[$fingerprint][$t] ?? 0], $starts);
        }

        return $result;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function occurrences(Issue $issue, Window $window): array
    {
        $window = $window->raw();
        $query = $this->raw->db()->table('nightowl_exceptions_v2 as e')
            ->whereRaw("e.fingerprint = decode(?, 'hex')", [strtolower($issue->group_hash)])
            ->where('e.created_at', '>=', $window->fromSql())->where('e.created_at', '<', $window->toSql())
            ->orderByDesc('e.created_at')->limit(25)
            ->select(['e.id', 'e.created_at', 'e.message', 'e.file', 'e.line', 'e.handled', 'e.user_id', 'e.trace_id', 'e.execution_id', 'e.execution_preview']);
        $query->leftJoin('nightowl_dict_string as src', 'src.id', '=', 'e.execution_source_id')->addSelect('src.value as source');

        $rows = $query->get();
        $names = $this->raw->userNames($rows->pluck('user_id')->filter()->map(fn ($id): string => (string) $id)->all());

        return $rows->map(fn (object $r): array => [
            'id' => (int) $r->id,
            'created_at' => Raw::iso($r->created_at),
            'message' => $r->message,
            'file' => $r->file,
            'line' => $r->line !== null ? (int) $r->line : null,
            'handled' => (bool) $r->handled,
            'user_id' => $r->user_id ?: null,
            'user_name' => $names[(string) $r->user_id]['name'] ?? null,
            'source' => $r->source,
            'execution_id' => $r->execution_id,
            'trace_id' => $r->trace_id,
            'execution_preview' => $r->execution_preview,
        ])->all();
    }

    /**
     * @return list<array{user_id: string, name: ?string, email: ?string, occurrences: int, last_seen_at: ?string}>
     */
    private function affectedUsers(Issue $issue, Window $window): array
    {
        $window = $window->raw();
        $rows = $this->raw->db()->table('nightowl_exceptions_v2')
            ->whereRaw("fingerprint = decode(?, 'hex')", [strtolower($issue->group_hash)])
            ->where('created_at', '>=', $window->fromSql())->where('created_at', '<', $window->toSql())
            ->whereNotNull('user_id')->where('user_id', '!=', '')
            ->groupBy('user_id')
            ->selectRaw('user_id, count(*) as n, max(created_at) as last_seen_at')
            ->orderByDesc('n')->limit(25)
            ->get();
        $names = $this->raw->userNames($rows->pluck('user_id')->map(fn ($id): string => (string) $id)->all());

        return $rows->map(fn (object $r): array => [
            'user_id' => (string) $r->user_id,
            'name' => $names[(string) $r->user_id]['name'] ?? null,
            'email' => $names[(string) $r->user_id]['email'] ?? null,
            'occurrences' => (int) $r->n,
            'last_seen_at' => Raw::iso($r->last_seen_at),
        ])->all();
    }
}
