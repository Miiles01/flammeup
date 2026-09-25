<?php
require __DIR__ . '/lib.php';

$products = db()->query('SELECT id, category, name, description, price_cents, has_sauce, featured, available, image FROM products ORDER BY sort')->fetchAll();
$sauces = db()->query('SELECT id, name, description, heat, color, available FROM sauces ORDER BY sort')->fetchAll();

foreach ($products as &$p) {
    foreach (['price_cents', 'has_sauce', 'featured', 'available'] as $k) $p[$k] = (int)$p[$k];
    $p['has_sauce'] = (bool)$p['has_sauce'];
    $p['featured'] = (bool)$p['featured'];
    $p['available'] = (bool)$p['available'];
}
foreach ($sauces as &$s) {
    $s['heat'] = (int)$s['heat'];
    $s['available'] = (bool)$s['available'];
}

json_out(['products' => $products, 'sauces' => $sauces, 'store' => store_status()]);
