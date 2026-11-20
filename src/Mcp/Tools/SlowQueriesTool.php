<?php

namespace Lookout\Mcp\Tools;

use Carbon\CarbonImmutable;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;
use Lookout\Services\Performance;
use Lookout\Services\QuerySources;
use Lookout\Services\Sources;
use Lookout\Services\Window;

#[IsReadOnly]
class SlowQueriesTool extends LookoutTool
{
    protected string $name = 'slow_queries';

    protected string $description = <<<'MARKDOWN'
        Database queries (normalised SQL, bindings as ?) over the last N hours with calls, total, average and p95 duration (ms). Includes the service when configured.
        Sort by p95 (default), total_ms, avg_ms or calls.
    MARKDOWN;

    public function schema(JsonSchema $schema): array
    {
        return [
            'hours' => $schema->integer()->description('Window in hours, 1-9600. Default 24.'),
            'limit' => $schema->integer()->description('Rows to return, 1-100. Default 20.'),
            'sort' => $schema->string()->enum(['p95', 'total_ms', 'avg_ms', 'calls'])->description('Sort order. Default p95.'),
            ...(Sources::enabled() ? SourceScope::schema($schema) : []),
        ];
    }

    public function handle(Request $request, Performance $performance, QuerySources $queries, Sources $sources): Response|ResponseFactory
    {
        if ($this->admin($request) === null) {
            return Response::error('Admins only.');
        }

        $hours = self::hours($request);
        $limit = self::limit($request);
        $sort = (string) ($request->get('sort') ?? 'p95');
        if (! Sources::enabled()) {
            return Response::structured(['hours' => $hours, 'queries' => $performance->queries($hours, $limit, $sort)]);
        }

        $scope = SourceScope::parse($request);
        if ($scope === null) {
            return Response::error('Invalid project, service or environment.');
        }

        [$project, $service, $environment] = $scope;
        $to = CarbonImmutable::now('UTC');
        $window = new Window($to->subHours($hours), $to);
        $services = $sources->scoped($project, $service, $environment);
        $nightowl = QuerySources::includesNightowl($services, $project, $service);

        return Response::structured([
            'hours' => $hours,
            'queries' => $queries->list($window, $services, $nightowl, $environment, $sort === 'p95' ? 'p95_ms' : $sort, 'desc', $limit),
        ]);
    }
}
