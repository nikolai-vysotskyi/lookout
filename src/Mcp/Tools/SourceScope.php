<?php

namespace Lookout\Mcp\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Lookout\Services\Sources;

final class SourceScope
{
    public static function schema(JsonSchema $schema): array
    {
        return [
            'project' => $schema->string()->description('Project slug from list_sources. Omit for all projects.'),
            'service' => $schema->string()->description('Service key (project/service) from list_sources. Omit for all services.'),
            'environment' => $schema->string()->description('Environment. Omit for all environments.'),
        ];
    }

    public static function parse(Request $request): ?array
    {
        $project = $request->get('project');
        $service = $request->get('service');
        $environment = $request->get('environment');
        if (($project !== null && (! is_string($project) || ! preg_match('~\A'.Sources::SLUG.'\z~', $project)))
            || ($service !== null && (! is_string($service) || ! preg_match('~\A'.Sources::SLUG.'/'.Sources::SLUG.'\z~', $service)))
            || ($environment !== null && (! is_string($environment) || $environment === '' || mb_strlen($environment) > 64))) {
            return null;
        }

        return [$project, $service, $environment];
    }
}
