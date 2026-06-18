<?php

namespace App\Contracts;

interface Loggable {
    public function log($message);
}

interface Serializable {
    public function serialize();
}
