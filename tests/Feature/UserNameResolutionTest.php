<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Lookout\Services\Raw;

/**
 * The lookup the raw lists use to show a name next to a user id: the agent's nightowl_users first, then the app's users.
 */
beforeEach(function () {
    config(['lookout.connection' => 'testing']);

    Schema::connection('testing')->create('nightowl_users', function (Blueprint $table): void {
        $table->string('user_id')->primary();
        $table->string('name')->nullable();
        $table->string('email')->nullable();
        $table->timestamps();
    });
});

it('resolves a name from nightowl_users, so a raw list can show it as it is', function () {
    $this->admin(); // the app's users table, which must not win over the agent's own record

    Schema::connection('testing')->getConnection()->table('nightowl_users')->insert([
        ['user_id' => '12', 'name' => 'Chris Rucker', 'email' => 'crucker@fordmodels.com'],
        ['user_id' => 'uuid-abc', 'name' => 'Loris Gendreau', 'email' => null],
    ]);

    $names = (new Raw)->userNames(['12', 'uuid-abc']);

    expect($names['12']['name'])->toBe('Chris Rucker')
        ->and($names['12']['email'])->toBe('crucker@fordmodels.com')
        ->and($names['uuid-abc']['name'])->toBe('Loris Gendreau');
});

it('falls back to the app user model for ids the agent did not send', function () {
    $admin = $this->admin();

    $names = (new Raw)->userNames([(string) $admin->id]);

    expect($names[(string) $admin->id]['name'])->toBe($admin->name)
        ->and($names[(string) $admin->id]['email'])->toBe($admin->email);
});

it('leaves unknown and empty ids out, so the SPA keeps its "User #<id>" label', function () {
    $names = (new Raw)->userNames(['999', '', 'not-a-user']);

    expect($names)->toBe([]);
});
