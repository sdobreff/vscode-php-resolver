<?php

namespace App\Aliases;

use App\Base\AbstractHandler as Handler;

class AliasedChild extends Handler {
    public function handle($input) {
        return trim($input);
    }
}
