<?php

namespace App\Rename;

class RenameTarget {
    public static function create() {
        return new RenameTarget();
    }
}

function rename_target_function() {
    $obj = new RenameTarget();
    return RenameTarget::create();
}
