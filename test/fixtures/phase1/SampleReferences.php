<?php

function foo() {
    return 'foo';
}

foo();

// foo() in a line comment should be ignored
$example = "foo() in string should be ignored";
/*
 * foo() in block comment should be ignored
 */
