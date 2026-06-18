<?php

namespace App\Base;

use App\Contracts\Loggable;

abstract class AbstractHandler implements Loggable {
    abstract public function handle($input);

    public function log($message) {
        echo $message;
    }
}
