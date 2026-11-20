<?php

namespace Lookout\Tests\Feature;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Lookout\Services\Sources;
use Lookout\Tests\TestCase;

final class SourcesTest extends TestCase
{
    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);

        $app['config']->set([
            'lookout.connection' => 'testing',
            'lookout.sources.enabled' => true,
            'lookout.sources.connection' => 'testing',
            'lookout.sources.nightowl_project' => 'assetfeed',
            'lookout.sources.nightowl_project_label' => 'AssetFeed',
            'lookout.sources.nightowl_service_label' => 'Laravel API',
        ]);
    }

    protected function defineDatabaseMigrations(): void
    {
        parent::defineDatabaseMigrations();
        $this->loadMigrationsFrom(__DIR__.'/../../database/sources');
    }

    public function test_registration_attaches_existing_history_and_catalog_is_admin_only(): void
    {
        [$exit, $token] = $this->sourceCommand(['--label' => 'Search', '--environment' => 'staging']);
        $this->assertSame(0, $exit);
        $this->assertMatchesRegularExpression('~\A'.Sources::TOKEN.'\z~', $token);

        $this->getJson('/lookout/api/sources')->assertUnauthorized();
        $this->actingAs($this->admin(false))->getJson('/lookout/api/sources')->assertForbidden();
        $catalog = $this->actingAs($this->admin())->getJson('/lookout/api/sources')->assertOk()
            ->assertJsonPath('projects.0.label', 'AssetFeed')
            ->assertJsonPath('services.0.key', 'assetfeed/laravel')
            ->assertJsonPath('services.0.connector', 'nightowl')
            ->assertJsonPath('services.1.key', 'assetfeed/search')
            ->assertJsonPath('services.1.environment', 'staging');
        $this->assertStringNotContainsString($token, $catalog->getContent());
        $this->assertStringNotContainsString(hash('sha256', $token), $catalog->getContent());

        $sources = app(Sources::class);
        $this->assertSame('search', $sources->authenticate($token)->slug);
        $this->assertSame(['laravel'], $sources->scoped('assetfeed', null, 'production')->pluck('slug')->all());
        $this->assertTrue($sources->scoped('other', 'assetfeed/search', null)->isEmpty());
        $this->assertSame(1, $this->sourceCommand()[0]);

        $adminToken = 'lookout-registry-reader-token-for-tests';
        config(['lookout.mcp.token' => $adminToken, 'lookout.mcp.user_id' => $this->admin()->id]);
        $this->postJson('/mcp/lookout', [
            'jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/call',
            'params' => ['name' => 'list_sources', 'arguments' => (object) []],
        ], ['Authorization' => 'Bearer '.$adminToken])->assertOk()->assertJsonPath(
            'result.structuredContent.services.1.key', 'assetfeed/search'
        );
    }

    public function test_rotation_revocation_and_pruning_keep_the_service_identity(): void
    {
        [, $original] = $this->sourceCommand();
        $sources = app(Sources::class);
        $id = $sources->authenticate($original)->id;
        $base = [
            'source_id' => $id, 'trace_id' => str_repeat('a', 32), 'duration_us' => 1000,
            'kind' => 'progress', 'name' => 'search.indexer', 'error' => false,
        ];
        DB::table('lookout_spans')->insert([
            $base + ['span_id' => str_repeat('b', 16), 'started_at' => now('UTC')->subDays(20)],
            $base + ['span_id' => str_repeat('c', 16), 'started_at' => now('UTC')->subHour()],
        ]);

        [$exit, $rotated] = $this->sourceCommand(['--rotate' => true]);
        $this->assertSame(0, $exit);
        $this->assertNull($sources->authenticate($original));
        $this->assertSame($id, $sources->authenticate($rotated)->id);
        $this->assertSame(0, $this->sourceCommand(['--revoke' => true])[0]);
        $this->assertNull($sources->authenticate($rotated));
        $this->assertSame(0, Artisan::call('lookout:prune-sources'));
        $this->assertSame([str_repeat('c', 16)], DB::table('lookout_spans')->pluck('span_id')->all());
        $this->assertSame($id, $sources->scoped('assetfeed', 'assetfeed/search')->first()->id);
    }

    private function sourceCommand(array $options = []): array
    {
        $exit = Artisan::call('lookout:source', ['project' => 'assetfeed', 'service' => 'search', ...$options]);

        return [$exit, trim(Artisan::output())];
    }
}
