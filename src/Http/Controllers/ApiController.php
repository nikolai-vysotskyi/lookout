<?php

namespace Lookout\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Validation\ValidationException;
use Lookout\Http\Requests\IssueUpdateRequest;
use Lookout\Http\Requests\WindowRequest;
use Lookout\Lookout;
use Lookout\Models\Issue;
use Lookout\Services\Details;
use Lookout\Services\IssueEditor;
use Lookout\Services\Issues;
use Lookout\Services\IssueStatus;
use Lookout\Services\QuerySources;
use Lookout\Services\Raw;
use Lookout\Services\Sources;
use Lookout\Services\SourceTelemetry;
use Lookout\Services\Telemetry;

/**
 * JSON endpoints of Lookout. Reads go to the lookout.connection connection; the writes are issue edits (status,
 * priority, assignee, description, comments) through IssueStatus / IssueEditor.
 */
class ApiController extends Controller
{
    private const ROLLUP_SORTS = ['calls', 'avg_ms', 'p95_ms', 'total_ms'];

    public function __construct(private Telemetry $telemetry, private Raw $raw, private Issues $issues, private Details $details) {}

    public function overview(WindowRequest $request): JsonResponse
    {
        return response()->json($this->telemetry->overview($request->window(), $request->environment()));
    }

    public function routes(WindowRequest $request): JsonResponse
    {
        $sort = $request->sort([...self::ROLLUP_SORTS, 'status_4xx', 'status_5xx', 'rate_4xx', 'rate_5xx'], 'p95_ms');

        return $this->list($request, 'routes', $this->telemetry->routes($request->window(), $request->environment(), $sort, $request->direction(), $request->limit(), $request->input('q'), $request->errorsOnly()), $sort);
    }

    public function route(WindowRequest $request, string $groupHash): JsonResponse
    {
        $route = $this->telemetry->route($groupHash, $request->window(), $request->environment());

        return $route === null ? response()->json(['message' => 'Route not found in this window.'], 404) : response()->json($route);
    }

    public function request(string $id): JsonResponse
    {
        $request = $this->raw->request($id);

        return $request === null ? response()->json(['message' => 'Request not found (raw rows are kept about 14 days).'], 404) : response()->json($request);
    }

    public function issues(WindowRequest $request): JsonResponse
    {
        $sort = $request->sort(['last_seen_at', 'first_seen_at', 'occurrences_count', 'users_count'], 'last_seen_at');

        return response()->json([
            'window' => $request->window()->toArray(),
            'sort' => $sort,
            'direction' => $request->direction(),
            ...$this->issues->list($request->window(), $request->environment(), [
                'status' => $request->input('status') ?? 'open',
                'type' => $request->input('type'),
                'priority' => $request->input('priority'),
                'assignee' => $request->filled('assignee') ? (string) $request->integer('assignee') : null,
                'q' => $request->input('q'),
            ], $request->user()?->id, $sort, $request->direction(), $request->limit(), $request->page()),
        ]);
    }

    public function issue(WindowRequest $request, int $issue): JsonResponse
    {
        return response()->json($this->issues->detail(Issue::query()->findOrFail($issue), $request->window()));
    }

    public function issueStatus(Request $request, int $issue, IssueStatus $status): JsonResponse
    {
        $validated = $request->validate(['status' => ['required', 'in:'.implode(',', Issue::STATUSES)]]);
        $model = Issue::query()->findOrFail($issue);
        $changed = $status->change($model, $validated['status'], $request->user(), 'monitoring');

        return response()->json(['issue' => $this->issues->summary($model->fresh()), 'changed' => $changed]);
    }

    public function updateIssue(IssueUpdateRequest $request, int $issue, IssueEditor $editor): JsonResponse
    {
        $model = Issue::query()->findOrFail($issue);
        $changed = $editor->update($model, $request->changes(), $request->user());

        return response()->json(['issue' => $this->issues->summary($model->fresh()), 'changed' => $changed]);
    }

    /**
     * The bulk bar: status, assignee and/or priority for up to 100 issues. Unknown ids are reported, not fatal.
     */
    public function bulkUpdate(IssueUpdateRequest $request, IssueEditor $editor): JsonResponse
    {
        $changes = $request->changes();
        if ($changes === []) {
            return response()->json(['message' => 'Nothing to change.', 'errors' => ['status' => ['Give status, priority or assigned_to.']]], 422);
        }

        $ids = array_map('intval', $request->validated('ids'));
        $found = Issue::query()->whereIn('id', $ids)->get();
        $updated = [];
        foreach ($found as $model) {
            if ($editor->update($model, $changes, $request->user()) !== []) {
                $updated[] = (int) $model->id;
            }
        }

        return response()->json(['updated' => $updated, 'unchanged' => array_values(array_diff($found->pluck('id')->map('intval')->all(), $updated)),
            'missing' => array_values(array_diff($ids, $found->pluck('id')->map('intval')->all()))]);
    }

    public function comment(Request $request, int $issue, IssueEditor $editor): JsonResponse
    {
        $validated = $request->validate(IssueEditor::commentRules());
        $comment = $editor->comment(Issue::query()->findOrFail($issue), $request->user(), trim($validated['body']));

        return response()->json(['comment' => Issues::comment($comment)], 201);
    }

    /**
     * Who an issue can be assigned to (Lookout::assignableUsersUsing()).
     */
    public function assignees(): JsonResponse
    {
        return response()->json(['assignees' => Lookout::assignableUsers(200)]);
    }

    public function jobs(WindowRequest $request): JsonResponse
    {
        $sort = $request->sort(['attempts', 'processed', 'failed', 'released', 'failure_rate', 'avg_ms', 'p95_ms', 'total_ms'], 'total_ms');

        return $this->list($request, 'jobs', $this->telemetry->jobs($request->window(), $request->environment(), $sort, $request->direction(), $request->limit(), $request->input('q'), $request->errorsOnly()), $sort);
    }

    public function job(WindowRequest $request, string $groupHash): JsonResponse
    {
        return self::found($this->details->job($groupHash, $request->window(), $request->environment()), 'Job not found in this window.');
    }

    public function jobAttempt(string $attemptId): JsonResponse
    {
        return self::found($this->details->jobAttempt($attemptId), 'Attempt not found (raw rows are kept about 14 days).');
    }

    public function command(WindowRequest $request, string $groupHash): JsonResponse
    {
        return self::found($this->details->command($groupHash, $request->window(), $request->environment()), 'Command not found in this window.');
    }

    public function commandRun(string $id): JsonResponse
    {
        return self::found($this->details->run('command', $id), 'Run not found (raw rows are kept about 14 days).');
    }

    public function scheduledTask(WindowRequest $request, string $groupHash): JsonResponse
    {
        return self::found($this->details->scheduledTask($groupHash, $request->window(), $request->environment()), 'Scheduled task not found in this window.');
    }

    public function scheduledTaskRun(string $id): JsonResponse
    {
        return self::found($this->details->run('scheduled_task', $id), 'Run not found (raw rows are kept about 14 days).');
    }

    public function exceptions(WindowRequest $request): JsonResponse
    {
        $sort = $request->sort(['count', 'handled', 'unhandled', 'users', 'first_seen_at', 'last_seen_at'], 'count');

        return $this->list($request, 'exceptions', $this->details->exceptions($request->window(), $request->environment(), $sort, $request->direction(),
            $request->limit(), $request->input('q'), $request->errorsOnly()), $sort);
    }

    /**
     * One exception fingerprint: counts over 24h / 7d / 30d and, when the agent grouped it into an issue, the issue
     * detail (stack trace, occurrences with their traces, affected users).
     */
    public function exception(WindowRequest $request, string $fingerprint): JsonResponse
    {
        $issue = Issue::query()->where('type', 'exception')->where('group_hash', $fingerprint)
            ->when($request->environment() !== null, fn ($q) => $q->where('environment', $request->environment()))->orderByDesc('last_seen_at')->first();
        $counts = $this->details->exceptionCounts($fingerprint, $request->environment());

        if ($issue === null && $counts['count_30d'] === 0) {
            return response()->json(['message' => 'Exception not found.'], 404);
        }

        return response()->json(['fingerprint' => $fingerprint, 'counts' => $counts, ...($issue !== null ? $this->issues->detail($issue, $request->window()) : ['window' => $request->window()->toArray(), 'issue' => null])]);
    }

    public function mailable(WindowRequest $request, string $groupHash): JsonResponse
    {
        return self::found($this->details->mail($groupHash, $request->window(), $request->environment()), 'Mailable not found in this window.');
    }

    public function notification(WindowRequest $request, string $groupHash): JsonResponse
    {
        return self::found($this->details->notification($groupHash, $request->window(), $request->environment()), 'Notification not found in this window.');
    }

    public function outgoingHost(WindowRequest $request, string $groupHash): JsonResponse
    {
        return self::found($this->details->outgoing($groupHash, $request->window(), $request->environment()), 'Host not found in this window.');
    }

    /**
     * @param  array<string, mixed>|null  $payload
     */
    private static function found(?array $payload, string $missing): JsonResponse
    {
        return $payload === null ? response()->json(['message' => $missing], 404) : response()->json($payload);
    }

    public function sources(Sources $sources): JsonResponse
    {
        return response()->json($sources->catalog());
    }

    public function queries(WindowRequest $request, Sources $sources, QuerySources $queries): JsonResponse
    {
        $sort = $request->sort([...self::ROLLUP_SORTS, 'max_ms'], 'total_ms');
        $window = $request->window();
        $project = $request->validated('project');
        $service = $request->validated('service');
        $environment = $request->environment();
        $connection = $request->validated('connection');
        $scope = $sources->scoped($project, $service, $environment);
        $nightowl = QuerySources::includesNightowl($scope, $project, $service);

        return response()->json([
            'window' => $window->toArray(),
            'sort' => $sort,
            'direction' => $request->direction(),
            'connection' => $connection,
            'connections' => $nightowl ? $this->telemetry->queryConnections($window, $environment) : [],
            'series' => $queries->series($window, $scope, $nightowl, $environment, $connection),
            'queries' => $queries->list($window, $scope, $nightowl, $environment, $sort, $request->direction(), $request->limit(), $request->input('q'), $connection),
            'n_plus_one' => $nightowl
                ? $this->raw->nPlusOne($window, $environment, (int) ($request->input('min_per_execution') ?? 5), min($request->limit(), 50))
                : null,
        ]);
    }

    public function query(WindowRequest $request, string $groupHash, Sources $sources): JsonResponse
    {
        $project = $request->validated('project');
        $service = $request->validated('service');
        $scope = $sources->scoped($project, $service, $request->environment());
        $details = QuerySources::includesNightowl($scope, $project, $service)
            ? $this->details->query($groupHash, $request->window(), $request->environment())
            : null;

        return self::found($details, 'Query not found in this window.');
    }

    public function sourceQuery(WindowRequest $request, int $sourceId, string $fingerprint, Sources $sources, SourceTelemetry $telemetry): JsonResponse
    {
        $scope = $sources->scoped($request->validated('project'), $request->validated('service'), $request->environment());
        $source = QuerySources::external($scope)->firstWhere('id', $sourceId);
        $details = $source === null ? null : $telemetry->queryDetail($request->window(), $source, $fingerprint);

        return self::found($details, 'Query not found in this window.');
    }

    public function workerProgress(WindowRequest $request, Sources $sources, SourceTelemetry $telemetry): JsonResponse
    {
        $window = $request->window();
        $scope = $sources->scoped($request->validated('project'), $request->validated('service'), $request->environment());
        $external = QuerySources::external($scope);

        return response()->json([
            'window' => $window->toArray(),
            'available' => $external->isNotEmpty(),
            ...$telemetry->activity($window, $external),
        ]);
    }

    public function outgoing(WindowRequest $request): JsonResponse
    {
        $sort = $request->sort([...self::ROLLUP_SORTS, 'status_4xx', 'status_5xx', 'error_rate'], 'total_ms');
        $window = $request->window();

        return response()->json(['window' => $window->toArray(), 'sort' => $sort, 'direction' => $request->direction(),
            'series' => $this->telemetry->outgoingSeries($window, $request->environment()),
            'outgoing' => $this->telemetry->outgoing($window, $request->environment(), $sort, $request->direction(), $request->limit(), $request->input('q'), $request->errorsOnly())]);
    }

    public function commands(WindowRequest $request): JsonResponse
    {
        $sort = $request->sort([...self::ROLLUP_SORTS, 'failed'], 'total_ms');

        return response()->json(['window' => $request->window()->toArray(), 'sort' => $sort, 'direction' => $request->direction(),
            ...$this->telemetry->commands($request->window(), $request->environment(), $sort, $request->direction(), $request->limit(), $request->input('q'), $request->errorsOnly()),
            ...$this->telemetry->commandSeries($request->window(), $request->environment())]);
    }

    public function mail(WindowRequest $request): JsonResponse
    {
        $sort = $request->sort([...self::ROLLUP_SORTS, 'queued', 'failed'], 'calls');

        return response()->json(['window' => $request->window()->toArray(), 'sort' => $sort, 'direction' => $request->direction(),
            ...$this->telemetry->mail($request->window(), $request->environment(), $sort, $request->direction(), $request->limit(), $request->input('q'), $request->errorsOnly()),
            ...$this->telemetry->mailSeries($request->window(), $request->environment())]);
    }

    public function cache(WindowRequest $request): JsonResponse
    {
        $sort = $request->sort(['calls', 'hits', 'misses', 'writes', 'deletes', 'failures', 'hit_rate', 'avg_ms'], 'calls');

        return response()->json(['window' => $request->window()->toArray(), 'sort' => $sort, 'direction' => $request->direction(),
            ...$this->telemetry->cache($request->window(), $request->environment(), $sort, $request->direction(), $request->limit(), $request->input('q'))]);
    }

    public function logs(WindowRequest $request): JsonResponse
    {
        if (($request->page() - 1) * $request->limit(50) > Raw::LOGS_MAX_OFFSET) {
            throw ValidationException::withMessages(['page' => 'Logs can be paged through the first '.number_format(Raw::LOGS_MAX_OFFSET).' entries. Narrow the window or the search.']);
        }

        return response()->json(['window' => $request->window()->raw()->toArray(), 'page' => $request->page(), 'limit' => $request->limit(50),
            ...$this->raw->logs($request->window(), $request->environment(), $request->input('level'), $request->input('q'), $request->limit(50), $request->page(), $request->input('user'))]);
    }

    public function users(WindowRequest $request): JsonResponse
    {
        $sort = $request->sort(['requests', 'status_4xx', 'status_5xx', 'exceptions', 'slow_requests'], 'requests');
        $slowMs = (int) ($request->input('slow_ms') ?? 1000);

        return response()->json(['window' => $request->window()->toArray(), 'sort' => $sort, 'direction' => $request->direction(), 'slow_ms' => $slowMs,
            'users' => $this->telemetry->users($request->window(), $request->environment(), $sort, $request->direction(), $request->limit(), $slowMs)]);
    }

    public function user(WindowRequest $request, string $userId): JsonResponse
    {
        return self::found($this->telemetry->user($userId, $request->window(), $request->environment()), 'User not found in this window.');
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    private function list(WindowRequest $request, string $key, array $rows, string $sort): JsonResponse
    {
        return response()->json(['window' => $request->window()->toArray(), 'sort' => $sort, 'direction' => $request->direction(), $key => $rows]);
    }
}
