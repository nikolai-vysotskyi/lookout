<?php

namespace Lookout\Mcp;

use Laravel\Mcp\Server;
use Lookout\Mcp\Tools\CommentIssueTool;
use Lookout\Mcp\Tools\CreateAlertChannelTool;
use Lookout\Mcp\Tools\DeleteAlertChannelTool;
use Lookout\Mcp\Tools\DeleteThresholdTool;
use Lookout\Mcp\Tools\FailedJobsTool;
use Lookout\Mcp\Tools\GetIssueTool;
use Lookout\Mcp\Tools\GetSettingsTool;
use Lookout\Mcp\Tools\ListIssuesTool;
use Lookout\Mcp\Tools\ListSourcesTool;
use Lookout\Mcp\Tools\ResolveIssueTool;
use Lookout\Mcp\Tools\SetAutoResolveTool;
use Lookout\Mcp\Tools\SetThresholdTool;
use Lookout\Mcp\Tools\SlowQueriesTool;
use Lookout\Mcp\Tools\SlowRoutesTool;
use Lookout\Mcp\Tools\UpdateAlertChannelTool;
use Lookout\Mcp\Tools\UpdateIssueTool;
use Lookout\Mcp\Tools\WorkerProgressTool;
use Lookout\Services\Sources;

/**
 * Admin-only MCP server over the self-hosted NightOwl monitoring data, mounted at lookout.mcp.path behind
 * AuthenticateMcpToken. Name and instructions come from config('lookout.mcp'). READ_TOOLS are there for every
 * credential, WRITE_TOOLS only for one with write access.
 */
class LookoutServer extends Server
{
    public const READ_TOOLS = [
        ListIssuesTool::class,
        GetIssueTool::class,
        SlowRoutesTool::class,
        SlowQueriesTool::class,
        FailedJobsTool::class,
        GetSettingsTool::class,
    ];

    public const WRITE_TOOLS = [
        ResolveIssueTool::class,
        UpdateIssueTool::class,
        CommentIssueTool::class,
        SetThresholdTool::class,
        DeleteThresholdTool::class,
        SetAutoResolveTool::class,
        CreateAlertChannelTool::class,
        UpdateAlertChannelTool::class,
        DeleteAlertChannelTool::class,
    ];

    protected string $name = 'Lookout (admin)';

    protected string $version = '1.0.0';

    protected array $tools = [...self::READ_TOOLS, ...self::WRITE_TOOLS];

    public const INSTRUCTIONS = <<<'MARKDOWN'
        Internal :app application monitoring (self-hosted NightOwl): errors grouped into issues, slow routes, slow queries, failed jobs and the monitoring settings.
        Start with list_issues, then get_issue for the stack trace; get_settings shows thresholds, alert channels and auto-resolve. Times are UTC, durations in milliseconds.
        Tools that change anything (resolve_issue, update_issue, comment_issue, set_threshold, delete_threshold, set_auto_resolve, create_alert_channel, update_alert_channel, delete_alert_channel) are listed only when the token has write access.
        MARKDOWN;

    protected string $instructions = self::INSTRUCTIONS;

    protected function boot(): void
    {
        $app = (string) (config('lookout.mcp.app_name') ?: config('app.name'));
        $this->name = (string) (config('lookout.mcp.server_name') ?: trim($app.' Lookout (admin)'));
        $this->instructions = str_replace(':app', $app, self::INSTRUCTIONS);
        if (Sources::enabled()) {
            $this->tools = [...$this->tools, ListSourcesTool::class, WorkerProgressTool::class];
        }
        $this->addMethod('tools/call', CallTool::class);
    }

    /**
     * @return list<string>
     */
    public static function writeToolNames(): array
    {
        return array_map(fn (string $class): string => app($class)->name(), self::WRITE_TOOLS);
    }
}
