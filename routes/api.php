<?php

use Illuminate\Support\Facades\Route;
use Lookout\Http\Controllers\ApiController;
use Lookout\Http\Controllers\McpTokenController;
use Lookout\Http\Controllers\SettingsController;

// JSON API of Lookout, mounted at /monitoring/api (LookoutServiceProvider::middleware()).
Route::get('overview', [ApiController::class, 'overview']);
Route::get('routes', [ApiController::class, 'routes']);
Route::get('routes/{groupHash}', [ApiController::class, 'route'])->where('groupHash', '[0-9a-f]{32}');
Route::get('requests/{id}', [ApiController::class, 'request'])
    ->where('id', '[0-9]{1,19}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
Route::get('issues', [ApiController::class, 'issues']);
Route::get('issues/assignees', [ApiController::class, 'assignees']);
Route::post('issues/bulk', [ApiController::class, 'bulkUpdate'])->name('lookout.issues.bulk');
Route::get('issues/{issue}', [ApiController::class, 'issue'])->whereNumber('issue');
Route::patch('issues/{issue}', [ApiController::class, 'updateIssue'])->whereNumber('issue');
Route::post('issues/{issue}/comments', [ApiController::class, 'comment'])->whereNumber('issue');
Route::post('issues/{issue}/status', [ApiController::class, 'issueStatus'])->whereNumber('issue');
Route::get('jobs', [ApiController::class, 'jobs']);
Route::get('jobs/{groupHash}', [ApiController::class, 'job'])->where('groupHash', '[0-9a-f]{32}');
Route::get('job-attempts/{attemptId}', [ApiController::class, 'jobAttempt'])->where('attemptId', '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
Route::get('commands/{groupHash}', [ApiController::class, 'command'])->where('groupHash', '[0-9a-f]{32}');
Route::get('commands/runs/{id}', [ApiController::class, 'commandRun'])->where('id', '[0-9]{1,19}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
Route::get('scheduled-tasks/{groupHash}', [ApiController::class, 'scheduledTask'])->where('groupHash', '[0-9a-f]{32}');
Route::get('scheduled-tasks/runs/{id}', [ApiController::class, 'scheduledTaskRun'])->where('id', '[0-9]{1,19}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
Route::get('exceptions', [ApiController::class, 'exceptions']);
Route::get('exceptions/{fingerprint}', [ApiController::class, 'exception'])->where('fingerprint', '[0-9a-f]{32}');
Route::get('mail/{groupHash}', [ApiController::class, 'mailable'])->where('groupHash', '[0-9a-f]{32}');
Route::get('notifications/{groupHash}', [ApiController::class, 'notification'])->where('groupHash', '[0-9a-f]{32}');
Route::get('outgoing/{groupHash}', [ApiController::class, 'outgoingHost'])->where('groupHash', '[0-9a-f]{32}');
Route::get('sources', [ApiController::class, 'sources']);
Route::get('worker-progress', [ApiController::class, 'workerProgress']);
Route::get('queries', [ApiController::class, 'queries']);
Route::get('queries/otlp/{sourceId}/{fingerprint}', [ApiController::class, 'sourceQuery'])
    ->whereNumber('sourceId')->where('fingerprint', '[0-9a-f]{32,64}');
Route::get('queries/{groupHash}', [ApiController::class, 'query'])->where('groupHash', '[0-9a-f]{32}');
Route::get('outgoing', [ApiController::class, 'outgoing']);
Route::get('commands', [ApiController::class, 'commands']);
Route::get('mail', [ApiController::class, 'mail']);
Route::get('cache', [ApiController::class, 'cache']);
Route::get('logs', [ApiController::class, 'logs']);
Route::get('users', [ApiController::class, 'users']);
Route::get('users/{userId}', [ApiController::class, 'user'])->where('userId', '[A-Za-z0-9_.@:-]{1,255}');

Route::get('settings', [SettingsController::class, 'show']);
Route::put('settings/thresholds', [SettingsController::class, 'thresholds']);
Route::put('settings/auto-resolve', [SettingsController::class, 'autoResolve']);
Route::post('settings/channels', [SettingsController::class, 'storeChannel']);
Route::patch('settings/channels/{channel}', [SettingsController::class, 'updateChannel'])->whereNumber('channel');
Route::delete('settings/channels/{channel}', [SettingsController::class, 'destroyChannel'])->whereNumber('channel');
Route::post('settings/telegram', [SettingsController::class, 'storeTelegram']);
Route::patch('settings/telegram/{channel}', [SettingsController::class, 'updateTelegram'])->whereNumber('channel');
Route::delete('settings/telegram/{channel}', [SettingsController::class, 'destroyTelegram'])->whereNumber('channel');
Route::post('settings/telegram/{channel}/test', [SettingsController::class, 'testTelegram'])->whereNumber('channel');

Route::get('mcp/config', [McpTokenController::class, 'config']);
Route::get('mcp/tokens', [McpTokenController::class, 'index']);
Route::post('mcp/tokens', [McpTokenController::class, 'store']);
Route::patch('mcp/tokens/{token}', [McpTokenController::class, 'update'])->whereNumber('token');
Route::delete('mcp/tokens/{token}', [McpTokenController::class, 'destroy'])->whereNumber('token');
