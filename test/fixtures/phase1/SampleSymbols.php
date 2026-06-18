<?php

namespace Demo\Phase1;

use Vendor\Package\ExternalClass;

class Alpha {
    public function run() {
        return true;
    }
}

function helper_function() {
    return new Alpha();
}
