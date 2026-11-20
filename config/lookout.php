<?php

return [

    /*
    | On/off. null follows nightowl.enabled: Lookout answers 404 and its schedule stays idle while NightOwl is off.
    */
    'enabled' => env('LOOKOUT_ENABLED'),

    /*
    | Where Lookout lives: the SPA shell at /{path}/{any?}, its JSON API at /{path}/api/*, its built assets at
    | /{path}/assets/*. domain = null serves it on every domain (with auth = nova: on nova.domain).
    */
    'path' => env('LOOKOUT_PATH', 'lookout'),

    'domain' => env('LOOKOUT_DOMAIN'),

    /*
    | Keep Lookout's own requests out of the telemetry: '{path}', '{path}/*' and the MCP path are appended to
    | nightowl.ignore_routes at boot (what the app configured there stays). Its pages and API carry MCP tokens, webhook
    | URLs and secrets that every other viewer would otherwise see on the request pages. Exceptions are still kept.
    */
    'ignore_own_routes' => (bool) env('LOOKOUT_IGNORE_OWN_ROUTES', true),

    /*
    | Who gets in.
    | - gate: the 'middleware' stack below, then the Gate ability 'gate' (denied unless the app defines it).
    | - nova: Nova's own API stack (nova.api_middleware: Nova login, Nova's gate, ...) on nova.domain, then the Gate
    |   ability 'gate'. Guests go to the Nova login, the user menu links back to Nova and signs out of Nova.
    | Either way Lookout is closed (404) while it is disabled.
    */
    'auth' => env('LOOKOUT_AUTH', 'gate'),

    'middleware' => ['web', 'auth'],

    'gate' => 'viewLookout',

    /*
    | The read connection of the NightOwl database. When it is not defined in config/database.php, Lookout defines it
    | from nightowl.database. Needs SELECT, plus UPDATE on nightowl_issues, INSERT on nightowl_issue_activity and
    | nightowl_issue_comments, and writes on nightowl_settings / nightowl_alert_channels for the Settings page (and
    | for lookout:telegram-notify, which keeps its watermarks in nightowl_settings with the default SettingStore).
    | MCP write tools use the same writes.
    */
    'connection' => env('LOOKOUT_DB_CONNECTION', 'nightowl_read'),

    /*
    | Projects and OpenTelemetry sources. The writer points to the same monitoring database as 'connection' and
    | falls back to NightOwl's PostgreSQL credentials. Enable before running the package migrations.
    */
    'sources' => [
        'enabled' => (bool) env('LOOKOUT_SOURCES_ENABLED', false),
        'connection' => env('LOOKOUT_INGEST_DB_CONNECTION', 'lookout_ingest'),
        'ingest_domain' => env('LOOKOUT_INGEST_DOMAIN'),
        'per_minute' => (int) env('LOOKOUT_INGEST_PER_MINUTE', 600),
        'retention_days' => (int) env('LOOKOUT_INGEST_RETENTION_DAYS', 14),
        'nightowl_project' => env('LOOKOUT_NIGHTOWL_PROJECT', 'default'),
        'nightowl_project_label' => env('LOOKOUT_NIGHTOWL_PROJECT_LABEL'),
        'nightowl_service' => env('LOOKOUT_NIGHTOWL_SERVICE', 'laravel'),
        'nightowl_service_label' => env('LOOKOUT_NIGHTOWL_SERVICE_LABEL', 'Laravel'),
    ],

    /*
    | The user model behind assignees, comments and MCP tokens; null = auth.providers.users.model.
    */
    'user_model' => null,

    /*
    | The SPA: the page title, the name in its sidebar (null = app.name), a link back to the app in the user menu
    | (null = none; filled by auth = nova), where "Sign out" posts (null = no sign-out item) and where it goes
    | afterwards, and the localStorage key prefix of its view preferences.
    */
    'title' => 'Lookout',

    'brand' => 'Lookout',

    'home' => null, // ['label' => 'Back to the app', 'url' => '/']

    'logout_url' => null,

    'login_url' => null,

    'storage_prefix' => 'lookout-',

    /*
    | lookout:auto-resolve resolves open issues not seen for the days chosen in Settings. Lookout schedules it daily
    | at 'at' while it is enabled; turn 'schedule' off to schedule it yourself.
    */
    'auto_resolve' => [
        'schedule' => true,
        'at' => '03:40',
    ],

    /*
    | Telegram alert channels, added in Settings and kept in the SettingStore (the NightOwl agent cannot send to
    | Telegram). lookout:telegram-notify runs every minute while Lookout and 'enabled' are on and posts issues that
    | became new or were reopened. api_base: the Bot API host, or a proxy in front of it. environment: whose issues
    | are sent; null = this app's (nightowl.environment, else app.env), '*' = every environment.
    */
    'telegram' => [
        'enabled' => (bool) env('LOOKOUT_TELEGRAM_ENABLED', true),
        'api_base' => env('LOOKOUT_TELEGRAM_API_BASE', 'https://api.telegram.org'),
        'environment' => env('LOOKOUT_TELEGRAM_ENVIRONMENT'),
    ],

    /*
    | The MCP server for coding agents (needs laravel/mcp). Opened by a personal token a user creates in Lookout
    | (token_prefix: at most 12 characters; stored in tokens_table) or by the shared token, which acts as user_id.
    | Credentials read only. A personal token writes (issues, thresholds, alert channels, auto-resolve) when its owner
    | turns on "Write access"; the shared token only with token_can_write (LOOKOUT_MCP_TOKEN_CAN_WRITE, off).
    | 'gate' is the ability a token's user must pass (null = the app's gate). per_minute is the limit per
    | credential, under rate_limiter. failed_per_minute: failed token checks per IP before it gets 429 for the rest of
    | the minute. The shared token should be a long random value (32+ characters; shorter ones log a warning).
    |
    | middleware: what runs after the token check; null = ThrottleRequests with rate_limiter, a list replaces it
    | (e.g. the app's own limiter). tokens_connection: where tokens_table lives (null = the default connection);
    | on another connection than the users table, user_id gets an index but no foreign key. user_id_type: 'bigint'
    | or 'int' (both unsigned where the database has it); null reads users.id when the migration runs.
    */
    'mcp' => [
        'enabled' => (bool) env('LOOKOUT_MCP_ENABLED', true),
        'path' => env('LOOKOUT_MCP_PATH', 'mcp/lookout'),
        'gate' => null,
        'token' => env('LOOKOUT_MCP_TOKEN'),
        'user_id' => env('LOOKOUT_MCP_USER_ID'),
        'token_can_write' => (bool) env('LOOKOUT_MCP_TOKEN_CAN_WRITE', false),
        'per_minute' => (int) env('LOOKOUT_MCP_PER_MINUTE', 600),
        'failed_per_minute' => (int) env('LOOKOUT_MCP_FAILED_PER_MINUTE', 30),
        'rate_limiter' => 'lookout-mcp',
        'middleware' => null,
        'tokens_connection' => env('LOOKOUT_MCP_TOKENS_CONNECTION'),
        'user_id_type' => null,
        'tokens_table' => 'lookout_mcp_tokens',
        'token_prefix' => 'lookout_',
        'server_name' => null, // null = "<app.name> Lookout (admin)"
        'client_name' => null, // the server's name in the client snippets; null = "<app-name>-lookout"
        'app_name' => null, // the app named in the server instructions; null = app.name
    ],

];
