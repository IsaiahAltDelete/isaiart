# Every model the game loads, in export order. "name:a,b" calls build_name(a, b)
# and exports as name_a_b.
MODEL_LIST = (["villager"] + [f"cottage:{a},{t}" for a in range(4) for t in range(2)] +
    ["lumber", "sawmill", "bakery", "windmill", "market", "storehouse", "quarry", "mason",
     "forager", "forester", "dock", "weaver", "creamery", "brewery", "tavern", "school", "watchtower", "wizard",
     "tiled:0", "tiled:1", "beehive", "lantern", "torch", "statue", "well",
     "sheep", "cow", "chicken", "crop_wheat", "crop_veg", "crop_pumpkin", "snowman", "sled",
     "guild", "forge", "tradepost", "fountain", "cart", "library", "tree_pine", "tree_pine2", "tree_round", "tree_round2", "tree_round3", "wolf", "boar", "goblin",
     "coop", "pasture", "dairy", "orchard", "bench", "sign", "fence", "flowers", "hay", "pumpkins", "palisade", "gnome", "swing",
     "maypole", "flowerarch", "sunflowers", "windchime", "pumpkinlantern", "scarecrow", "snowlantern", "wintertree"])
