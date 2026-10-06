"""Checks the committed arenas against docs/design/arenas.md, sections 3 to 7.

`validate_glb.py` checks the JSON schema, bounds and symmetry. The principles
are about play: spawn spacing and clearances, how tall a blocking obstacle
looks, cover density, gaps, how far a player is from cover and whether the end
circle of the sudden death ring is open floor. Standard library only, no
Blender.

The test globs `data/arenas/*.json`, so a new arena is checked without an edit
here. Every arena must break no rule, except the ids in ALLOWED_DEVIATIONS.
arena01 is grandfathered. It breaks two rules, and it cannot change because
every sim fixture checksums `state.arena`. The test pins both deviations, so a
third one, or a repair that goes unnoticed, fails here.
"""
import copy
import json
import math
import shutil
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ARENAS_DIR = REPO / "data" / "arenas"

CHAMPION_RADIUS = 0.5
OPPOSING_SPAWNS = (20.0, 26.0)
PAIR_SPACING = (2.0, 4.0)
MIN_TEAMMATES = 2.0
MIN_SPAWN_TO_WALL = 2.0
MIN_SPAWN_TO_OBSTACLE = 3.0
MIN_BLOCKING_HEIGHT = 1.8
MAX_LOW_HEIGHT = 0.8
COVER_SHARE = (0.05, 0.10)
MAX_EXTENT = 6.0
MIN_GAP = 1.5
MAX_COVER_DISTANCE = 8.0
MIN_END_CIRCLE_AREA = 20.0
COVER_GRID = 0.25
AREA_GRID = 0.05
EPS = 1e-9


# The rules an arena may break, by id. arena01 is grandfathered by decision 14 on issue #63. No
# other arena may break a rule, so a new arena needs no entry here.
ALLOWED_DEVIATIONS = {"arena01": ["heights", "cover reach"]}


def load_arena(arena_id, directory=ARENAS_DIR):
    with open(Path(directory) / ("%s.json" % arena_id)) as f:
        return json.load(f)


def committed_arena_ids(directory):
    return sorted(path.stem for path in Path(directory).glob("*.json"))


# geometry. An obstacle is a circle {x, y, r} or a rect {x, y, w, h}.


def point_to_rect(px, py, o):
    dx = max(abs(px - o["x"]) - o["w"] / 2, 0)
    dy = max(abs(py - o["y"]) - o["h"] / 2, 0)
    return math.hypot(dx, dy)


def point_to_obstacle(px, py, o):
    """Distance from a point to the obstacle, 0 inside it."""
    if o["type"] == "circle":
        return max(math.hypot(px - o["x"], py - o["y"]) - o["r"], 0)
    return point_to_rect(px, py, o)


def obstacle_gap(a, b):
    """The exact distance between two obstacles, 0 when they touch or overlap."""
    if a["type"] == "circle" and b["type"] == "circle":
        return max(math.hypot(a["x"] - b["x"], a["y"] - b["y"]) - a["r"] - b["r"], 0)
    if a["type"] == "circle":
        return max(point_to_rect(a["x"], a["y"], b) - a["r"], 0)
    if b["type"] == "circle":
        return max(point_to_rect(b["x"], b["y"], a) - b["r"], 0)
    dx = max(abs(a["x"] - b["x"]) - (a["w"] + b["w"]) / 2, 0)
    dy = max(abs(a["y"] - b["y"]) - (a["h"] + b["h"]) / 2, 0)
    return math.hypot(dx, dy)


def half_extents(o):
    return (o["r"], o["r"]) if o["type"] == "circle" else (o["w"] / 2, o["h"] / 2)


def wall_gap(arena, o):
    half_w, half_h = arena["size"]["width"] / 2, arena["size"]["height"] / 2
    ex, ey = half_extents(o)
    return min(half_w - (o["x"] + ex), o["x"] - ex + half_w, half_h - (o["y"] + ey), o["y"] - ey + half_h)


def area(o):
    return math.pi * o["r"] ** 2 if o["type"] == "circle" else o["w"] * o["h"]


def extent(o):
    return 2 * o["r"] if o["type"] == "circle" else max(o["w"], o["h"])


def spawns(arena):
    return arena["spawns"]["teamA"], arena["spawns"]["teamB"]


def grid(start, stop, step):
    """Cell centres of a grid from start to stop."""
    n = int(round((stop - start) / step))
    return [start + (i + 0.5) * step for i in range(n)]


def max_cover_distance(arena):
    """The largest distance from a floor point to blocking cover, on a 0.25 m grid with the edges."""
    blockers = [o for o in arena["obstacles"] if o["blocksProjectiles"]]
    half_w, half_h = arena["size"]["width"] / 2, arena["size"]["height"] / 2
    worst = 0.0
    for i in range(int(2 * half_w / COVER_GRID) + 1):
        for j in range(int(2 * half_h / COVER_GRID) + 1):
            px, py = -half_w + i * COVER_GRID, -half_h + j * COVER_GRID
            nearest = min((point_to_obstacle(px, py, o) for o in blockers), default=math.inf)
            worst = max(worst, nearest)
    return worst


def walkable_end_circle_area(arena):
    """The area of the end circle that no obstacle covers, sampled on a 0.05 m grid."""
    end = arena["ring"]["endRadius"]
    cell = AREA_GRID * AREA_GRID
    total = 0.0
    for px in grid(-end, end, AREA_GRID):
        for py in grid(-end, end, AREA_GRID):
            if px * px + py * py > end * end:
                continue
            if all(point_to_obstacle(px, py, o) > 0 for o in arena["obstacles"]):
                total += cell
    return total


# the checks. Each returns a problem string, or None. A problem starts with the rule's name.


def check_team_sides(arena):
    a, b = spawns(arena)
    if any(x >= 0 for x, _ in a) or any(x <= 0 for x, _ in b):
        return "team sides: team A must spawn in the west half and team B in the east half"


def check_opposing_distance(arena):
    a, b = spawns(arena)
    low, high = OPPOSING_SPAWNS
    for p in a:
        for q in b:
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            if not low - EPS <= d <= high + EPS:
                return "opposing spawns: %s and %s are %.2f m apart, the range is %g to %g m" % (p, q, d, low, high)


def check_pair(arena):
    for team in spawns(arena):
        (x1, y1), (x2, y2) = team[0], team[1]
        d = math.hypot(x1 - x2, y1 - y2)
        if not PAIR_SPACING[0] - EPS <= d <= PAIR_SPACING[1] + EPS:
            return "2v2 pair: %.2f m apart, the range is %g to %g m" % (d, *PAIR_SPACING)
        if x1 != x2 or y1 != -y2:
            return "2v2 pair: %s and %s are not mirrored across y = 0" % (team[0], team[1])
        if len(team) > 2:
            x3, y3 = team[2]
            d1, d2 = math.hypot(x3 - x1, y3 - y1), math.hypot(x3 - x2, y3 - y2)
            if abs(d1 - d2) > EPS:
                return "third spawn: %.2f m and %.2f m from its teammates, it must be equal" % (d1, d2)


def check_teammates(arena):
    for team in spawns(arena):
        for i, p in enumerate(team):
            for q in team[i + 1 :]:
                d = math.hypot(p[0] - q[0], p[1] - q[1])
                if d < MIN_TEAMMATES - EPS:
                    return "teammates: %s and %s are %.2f m apart, the minimum is %g m" % (p, q, d, MIN_TEAMMATES)


def check_spawn_clearance(arena):
    half_w, half_h = arena["size"]["width"] / 2, arena["size"]["height"] / 2
    for team in spawns(arena):
        for x, y in team:
            wall = min(half_w - abs(x), half_h - abs(y))
            if wall < MIN_SPAWN_TO_WALL - EPS:
                return "spawn clearance: (%g, %g) is %.2f m from the wall, the minimum is %g m" % (x, y, wall, MIN_SPAWN_TO_WALL)
            for o in arena["obstacles"]:
                d = point_to_obstacle(x, y, o)
                if d < MIN_SPAWN_TO_OBSTACLE - EPS:
                    return "spawn clearance: (%g, %g) is %.2f m from an obstacle, the minimum is %g m" % (x, y, d, MIN_SPAWN_TO_OBSTACLE)


def check_heights(arena):
    for i, o in enumerate(arena["obstacles"]):
        if o["blocksProjectiles"] and o["height"] < MIN_BLOCKING_HEIGHT - EPS:
            return "heights: blocking obstacle %d is %g m high, the minimum is %g m" % (i, o["height"], MIN_BLOCKING_HEIGHT)
        if not o["blocksProjectiles"] and o["height"] > MAX_LOW_HEIGHT + EPS:
            return "heights: low obstacle %d is %g m high, the maximum is %g m" % (i, o["height"], MAX_LOW_HEIGHT)


def check_cover_share(arena):
    share = sum(area(o) for o in arena["obstacles"]) / (arena["size"]["width"] * arena["size"]["height"])
    if not COVER_SHARE[0] <= share <= COVER_SHARE[1]:
        return "cover share: %.1f percent, the range is %g to %g percent" % (share * 100, COVER_SHARE[0] * 100, COVER_SHARE[1] * 100)


def check_extent(arena):
    for i, o in enumerate(arena["obstacles"]):
        if extent(o) > MAX_EXTENT + EPS:
            return "extent: obstacle %d is %g m long, the maximum is %g m" % (i, extent(o), MAX_EXTENT)


def check_mirrored_kinds(arena):
    for blocks in (True, False):
        pairs = [
            o
            for o in arena["obstacles"]
            if o["x"] < 0 and o["blocksProjectiles"] == blocks and dict(o, x=-o["x"]) in arena["obstacles"]
        ]
        if not pairs:
            return "mirrored kinds: no mirrored pair with blocksProjectiles %s" % str(blocks).lower()


def check_gaps(arena):
    obstacles = arena["obstacles"]
    for i, a in enumerate(obstacles):
        gap = wall_gap(arena, a)
        if gap < MIN_GAP - EPS:
            return "gaps: obstacle %d is %.2f m from the wall, the minimum is %g m" % (i, gap, MIN_GAP)
        for j in range(i + 1, len(obstacles)):
            gap = obstacle_gap(a, obstacles[j])
            if gap < MIN_GAP - EPS:
                return "gaps: obstacles %d and %d are %.2f m apart, the minimum is %g m" % (i, j, gap, MIN_GAP)


def check_cover_reach(arena):
    worst = max_cover_distance(arena)
    if worst > MAX_COVER_DISTANCE + EPS:
        return "cover reach: a floor point is %.2f m from blocking cover, the maximum is %g m" % (worst, MAX_COVER_DISTANCE)


def check_end_circle(arena):
    walkable = walkable_end_circle_area(arena)
    if walkable < MIN_END_CIRCLE_AREA:
        return "end circle: %.1f m2 of walkable floor, the minimum is %g m2" % (walkable, MIN_END_CIRCLE_AREA)


CHECKS = (
    check_team_sides,
    check_opposing_distance,
    check_pair,
    check_teammates,
    check_spawn_clearance,
    check_heights,
    check_cover_share,
    check_extent,
    check_mirrored_kinds,
    check_gaps,
    check_cover_reach,
    check_end_circle,
)


def principle_problems(arena):
    """One message per broken rule of arenas.md sections 3 to 7. An empty list means they all hold."""
    return [p for p in (check(arena) for check in CHECKS) if p is not None]


def rule_names(problems):
    return [p.split(":")[0] for p in problems]


def unexpected_deviations(directory):
    """Every arena of the directory whose broken rules differ from its allowed ones, by id."""
    found = {}
    for arena_id in committed_arena_ids(directory):
        broken = rule_names(principle_problems(load_arena(arena_id, directory)))
        if broken != ALLOWED_DEVIATIONS.get(arena_id, []):
            found[arena_id] = broken
    return found


def mutated(arena_id, change):
    arena = copy.deepcopy(load_arena(arena_id))
    change(arena)
    return arena


class CommittedArenaTests(unittest.TestCase):
    def test_every_committed_arena_has_only_its_allowed_deviations(self):
        self.assertEqual(unexpected_deviations(ARENAS_DIR), {})

    def test_the_glob_finds_every_committed_arena(self):
        ids = committed_arena_ids(ARENAS_DIR)
        self.assertIn("arena01", ids)
        self.assertIn("arena02", ids)

    def test_the_glob_catches_a_new_arena_that_breaks_a_principle(self):
        with tempfile.TemporaryDirectory() as tmp:
            for arena_id in ("arena01", "arena02"):
                shutil.copy(ARENAS_DIR / ("%s.json" % arena_id), tmp)
            broken = load_arena("arena02")
            broken["id"] = "arena03"
            broken["obstacles"][0]["height"] = 1.0
            with open(Path(tmp) / "arena03.json", "w") as f:
                json.dump(broken, f)
            self.assertEqual(unexpected_deviations(tmp), {"arena03": ["heights"]})

    def test_the_glob_catches_a_repaired_grandfathered_arena(self):
        with tempfile.TemporaryDirectory() as tmp:
            for arena_id in ("arena01", "arena02"):
                shutil.copy(ARENAS_DIR / ("%s.json" % arena_id), tmp)
            repaired = load_arena("arena02")
            repaired["id"] = "arena01"
            with open(Path(tmp) / "arena01.json", "w") as f:
                json.dump(repaired, f)
            self.assertEqual(unexpected_deviations(tmp), {"arena01": []})

    def test_every_arena_but_the_grandfathered_one_follows_every_principle(self):
        for arena_id in committed_arena_ids(ARENAS_DIR):
            if arena_id in ALLOWED_DEVIATIONS:
                continue
            with self.subTest(arena=arena_id):
                self.assertEqual(principle_problems(load_arena(arena_id)), [])

    def test_arena01_breaks_exactly_its_two_known_deviations(self):
        # Six blocking obstacles are 1.5 m high, and the corners are 10.7 m from blocking cover.
        problems = principle_problems(load_arena("arena01"))
        self.assertEqual(rule_names(problems), ["heights", "cover reach"], problems)
        self.assertIn("1.5 m high", problems[0])
        self.assertIn("10.7", problems[1])

    def test_arena02_layout_numbers(self):
        arena = load_arena("arena02")
        share = sum(area(o) for o in arena["obstacles"]) / (arena["size"]["width"] * arena["size"]["height"])
        self.assertAlmostEqual(share, 0.0602, places=3)
        self.assertAlmostEqual(max_cover_distance(arena), 7.49, places=2)
        # The 0.05 m grid gives 28.26 m2. The exact end circle is 28.274 m2.
        self.assertAlmostEqual(walkable_end_circle_area(arena), 28.26, places=2)


class PrincipleCheckTests(unittest.TestCase):
    """Each check must be able to fail, so a bad layout cannot pass in CI. Each case mutates arena02."""

    def assertBreaks(self, rule, change, text=None):
        problems = principle_problems(mutated("arena02", change))
        self.assertIn(rule, rule_names(problems), problems)
        if text is not None:
            self.assertTrue(any(text in p for p in problems), "%r not in %r" % (text, problems))

    def test_team_sides(self):
        self.assertBreaks("team sides", lambda a: a["spawns"]["teamA"].__setitem__(2, [0.5, 0]))

    def test_opposing_distance(self):
        self.assertBreaks("opposing spawns", lambda a: a["spawns"]["teamB"].__setitem__(0, [8, 2]))

    def test_pair_spacing(self):
        # 5.00 m apart and mirrored, so only the spacing message applies.
        self.assertBreaks(
            "2v2 pair",
            lambda a: a["spawns"]["teamA"].__setitem__(slice(0, 2), [[-11, 2.5], [-11, -2.5]]),
            "the range is",
        )

    def test_pair_mirror(self):
        self.assertBreaks("2v2 pair", lambda a: a["spawns"]["teamA"].__setitem__(1, [-11, -1.5]))

    def test_third_spawn_equidistant(self):
        self.assertBreaks("third spawn", lambda a: a["spawns"]["teamA"].__setitem__(2, [-12.5, 0.5]))

    def test_teammates(self):
        # A 3 m pair with the third spawn between them leaves it 1.5 m from each.
        def change(a):
            a["spawns"]["teamA"] = [[-11, 1.5], [-11, -1.5], [-11, 0]]

        self.assertBreaks("teammates", change)

    def test_spawn_clearance_to_the_wall(self):
        self.assertBreaks("spawn clearance", lambda a: a["spawns"]["teamA"].__setitem__(2, [-14, 0]))

    def test_spawn_clearance_to_an_obstacle(self):
        self.assertBreaks("spawn clearance", lambda a: a["spawns"]["teamA"].__setitem__(0, [-11, 3.5]))

    def test_blocking_height(self):
        self.assertBreaks("heights", lambda a: a["obstacles"][0].__setitem__("height", 1.6))

    def test_low_height(self):
        self.assertBreaks("heights", lambda a: a["obstacles"][8].__setitem__("height", 0.9))

    def test_cover_share_too_high(self):
        # 36 m2 more is 72 m2, 12 percent.
        def change(a):
            a["obstacles"].append(
                {"type": "rect", "x": 0, "y": 0, "w": 6, "h": 6, "height": 2.0, "blocksProjectiles": True}
            )

        self.assertBreaks("cover share", change)

    def test_cover_share_too_low(self):
        self.assertBreaks("cover share", lambda a: a.__setitem__("obstacles", a["obstacles"][:2]))

    def test_extent(self):
        self.assertBreaks("extent", lambda a: a["obstacles"][0].update(h=7))

    def test_mirrored_pair_that_blocks(self):
        def change(a):
            for o in a["obstacles"]:
                o["blocksProjectiles"] = False

        self.assertBreaks("mirrored kinds", change)

    def test_mirrored_pair_that_does_not_block(self):
        def change(a):
            for o in a["obstacles"]:
                o["blocksProjectiles"] = True

        self.assertBreaks("mirrored kinds", change)

    def test_gap_to_the_wall(self):
        self.assertBreaks("gaps", lambda a: a["obstacles"][6].update(y=9.0))

    def test_gap_between_obstacles(self):
        # The pillar at (-5.5, 6) is 0.41 m from the corner (-4.5, 5) of low wall 8.
        self.assertBreaks("gaps", lambda a: a["obstacles"][2].update(x=-5.5))

    def test_cover_reach(self):
        def change(a):
            a["obstacles"] = [o for i, o in enumerate(a["obstacles"]) if i not in (2, 3, 4, 5)]

        self.assertBreaks("cover reach", change)

    def test_end_circle(self):
        def change(a):
            a["obstacles"].append(
                {"type": "circle", "x": 0, "y": 0, "r": 2.5, "height": 2.0, "blocksProjectiles": True}
            )

        self.assertBreaks("end circle", change)

    def test_only_the_broken_rule_is_reported(self):
        problems = principle_problems(mutated("arena02", lambda a: a["obstacles"][0].update(height=1.6)))
        self.assertEqual(rule_names(problems), ["heights"])


class GeometryTests(unittest.TestCase):
    def test_circle_and_rect_gaps(self):
        circle = {"type": "circle", "x": 0, "y": 0, "r": 1}
        rect = {"type": "rect", "x": 4, "y": 0, "w": 2, "h": 2}
        self.assertAlmostEqual(obstacle_gap(circle, rect), 2.0)
        self.assertAlmostEqual(obstacle_gap(rect, circle), 2.0)
        corner = {"type": "rect", "x": 3, "y": 3, "w": 2, "h": 2}
        self.assertAlmostEqual(obstacle_gap(circle, corner), math.hypot(2, 2) - 1)

    def test_rect_gaps(self):
        a = {"type": "rect", "x": 0, "y": 0, "w": 2, "h": 2}
        b = {"type": "rect", "x": 5, "y": 4, "w": 2, "h": 2}
        self.assertAlmostEqual(obstacle_gap(a, b), math.hypot(3, 2))


if __name__ == "__main__":
    unittest.main()
