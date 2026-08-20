<?php

declare(strict_types=1);

namespace Omd\Auth;

/** The signed-in account, as `req.user` carried it in Express. */
final class AuthenticatedUser
{
    public function __construct(
        public readonly string $id,
        public readonly string $name,
        public readonly string $email,
        /** ADMIN | EDITOR | VIEWER */
        public readonly string $role,
        public readonly bool $mustChangePassword,
    ) {
    }

    public function isAdmin(): bool
    {
        return $this->role === 'ADMIN';
    }

    public function canWrite(): bool
    {
        return $this->role === 'ADMIN' || $this->role === 'EDITOR';
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'role' => $this->role,
            'mustChangePassword' => $this->mustChangePassword,
        ];
    }
}
