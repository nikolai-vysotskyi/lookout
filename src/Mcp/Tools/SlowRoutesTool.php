<?php

namespace Lookout\Mcp\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Carbon\CarbonImmutable;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;
use Lookout\Services\Performance;
use Lookout\Services\QuerySources;
use Lookout\Services\SourceTelemetry;
use Lookout\Services\Sources;
use Lookout\Services\Telemetry;
use Lookout\Services\Window;

#[IsReadOnly]
class SlowRoutesTool extends LookoutTool
{
    protected string $name = 'slow_routes';

    protected string $description = <<<'MARKDOWN'
        HTTP routes over the last N hours: calls, 4xx and 5xx counts, error rate (%), average and p95 duration (ms). Laravel routes come from NightOwl rollups, other services' routes from their OpenTelemetry server spans; each row names its service when projects are enabled.
        Sort by p95 (default), avg_ms, calls or error_rate.
    MARKDOWN;

    public function schema(JsonSchema $schema): array
    {
        return [
            'hours' => $schema->integer()->description('Window in hours, 1-9600. Default 24.'),
            'limit' => $schema->integer()->description('Rows to return, 1-100. Default 20.'),
            'sort' => $schema->string()->enum(['p95', 'avg_ms', 'calls', 'error_rate'])->description('Sort order. Default p95.'),
            ...(Sources::enabled() ? SourceScope::schema($schema) : []),
        ];
    }

    public function handle(Request $request, Performance $performance, SourceTelemetry $telemetry, Sources $sources): Response|ResponseFactory
    {
        if ($this->admin($request) === null) {
            return Response::error('Admins only.');
        }

        $hours = self::hours($request);
        $limit = self::limit($request);
        $sort = (string) ($request->get('sort') ?? 'p95');
        if (! Sources::enabled()) {
            return Response::structured(['hours' => $hours, 'routes' => $performance->routes($hours, $limit, $sort)]);
        }

        $scope = SourceScope::parse($request);
        if ($scope === null) {
            return Response::error('Invalid project, service or environment.');
        }

        [$project, $service, $environment] = $scope;
        $services = $sources->scoped($project, $service, $environment);
        $nightowl = $services->firstWhere('connector', 'nightowl');
        $legacy = QuerySources::includesNightowl($services, $project, $service) ? array_map(fn (array $row): array => [
            ...$row,
            ...($nightowl === null ? [] : ['project' => $nightowl->project, 'service' => Sources::key($nightowl), 'service_label' => $nightowl->label]),
        ], $performance->routes($hours, $limit, $sort)) : [];
        $to = CarbonImmutable::now('UTC');
        $external = $telemetry->routeRows(new Window($to->subHours($hours), $to), QuerySources::external($services), $sort, $limit);

        return Response::structured([
            'hours' => $hours,
            'routes' => Telemetry::sortRows([...$legacy, ...$external], match ($sort) {
                'avg_ms' => 'avg_ms',
                'calls' => 'calls',
                'error_rate' => 'error_rate',
                default => 'p95_ms',
            }, 'desc', $limit),
        ]);
    }
}
