<?php

namespace Lookout\Tests\Feature;

use Lookout\LookoutServiceProvider;
use Lookout\Services\Sources;
use Orchestra\Testbench\TestCase;

final class DefaultWriterConnectionTest extends TestCase
{
    protected function getPackageProviders($app): array
    {
        return [LookoutServiceProvider::class];
    }

    protected function defineEnvironment($app): void
    {
        $app['config']->set([
            'lookout.sources.enabled' => true,
            'database.connections.nightowl_read.driver' => 'pgsql',
            'database.connections.nightowl_read.username' => 'reader',
            'nightowl.database' => [
                'host' => 'monitoring-db',
                'database' => 'monitoring',
                'username' => 'writer',
                'password' => 'test-fixture',
            ],
        ]);
    }

    public function test_default_otlp_writer_uses_nightowl_settings_and_preserves_existing_reader(): void
    {
        $this->assertSame('lookout_ingest', Sources::connectionName());
        $this->assertSame('monitoring-db', config('database.connections.lookout_ingest.host'));
        $this->assertSame('monitoring', app(Sources::class)->connection()->getDatabaseName());
        $this->assertSame('writer', config('database.connections.lookout_ingest.username'));
        $this->assertSame('reader', config('database.connections.nightowl_read.username'));
    }
}
