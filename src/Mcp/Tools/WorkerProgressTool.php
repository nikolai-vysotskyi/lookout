<?php

namespace Lookout\Mcp\Tools;

use Carbon\CarbonImmutable;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;
use Lookout\Services\QuerySources;
use Lookout\Services\Sources;
use Lookout\Services\SourceTelemetry;
use Lookout\Services\Window;

#[IsReadOnly]
class WorkerProgressTool extends LookoutTool
{
    protected string $name = 'worker_progress';

    protected string $description = 'Show the latest successful run and grouped errors by operation for OpenTelemetry services within the given window.';

    public function schema(JsonSchema $schema): array
    {
        return [
            'hours' => $schema->integer()->description('Window in hours, 1-9600. Default 24.'),
            ...SourceScope::schema($schema),
        ];
    }

    public function handle(Request $request, Sources $sources, SourceTelemetry $telemetry): Response|ResponseFactory
    {
        if ($this->admin($request) === null) {
            return Response::error('Admins only.');
        }

        $scope = SourceScope::parse($request);
        if ($scope === null) {
            return Response::error('Invalid project, service or environment.');
        }

        $hours = self::hours($request);
        $to = CarbonImmutable::now('UTC');
        $services = QuerySources::external($sources->scoped(...$scope));

        return Response::structured([
            'hours' => $hours,
            ...$telemetry->activity(new Window($to->subHours($hours), $to), $services),
        ]);
    }
}
