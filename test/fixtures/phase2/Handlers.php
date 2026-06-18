<?php

namespace App\Handlers;

use App\Base\AbstractHandler;
use App\Contracts\Serializable;

class ConcreteHandler extends AbstractHandler implements Serializable {
    public function handle($input) {
        return $input;
    }

    public function serialize() {
        return json_encode([]);
    }
}

class SpecialHandler extends ConcreteHandler {
    public function handle($input) {
        return strtoupper($input);
    }
}

class UnrelatedClass {
    public function handle($input) {
        return null;
    }
}
