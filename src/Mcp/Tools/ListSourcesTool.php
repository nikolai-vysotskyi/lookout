<?php

namespace Lookout\Mcp\Tools;

use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;
use Lookout\Services\Sources;

#[IsReadOnly]
class ListSourcesTool extends LookoutTool
{
    protected string $name = 'list_sources';

    protected string $description = 'List monitoring projects and services with their connector and environment.';

    public function handle(Request $request, Sources $sources): Response|ResponseFactory
    {
        if ($this->admin($request) === null) {
            return Response::error('Admins only.');
        }

        return Response::structured($sources->catalog());
    }
}
