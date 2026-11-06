import { LINE_HEIGHT, Point } from "./renderer";
import { Shape } from "./Game";

export type Bounds = { left: number; top: number; right: number; bottom: number };
/**
 * A grip on the selection box: four corners and four edge midpoints.
 *
 * Corners change both axes at once; edges change one and leave the other
 * exactly as it was. Dragging a corner "straight across" is never quite
 * straight, so stretching only the width is a thing you cannot do without
 * them.
 */
export type Corner = "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w";
export type Handle = { corner: Corner; x: number; y: number };

/**
 * A shape can never be scaled below this, in pixels.
 *
 * Without a floor, dragging a handle past the anchor collapses a shape to a
 * dot whose own handles are then too small to grab - unrecoverable without
 * deleting it and starting again.
 */
const MIN_SIZE = 8;
/** The grip that stays put while another is dragged. */
export const OPPOSITE: Record<Corner, Corner> = {
    nw: "se",
    ne: "sw",
    se: "nw",
    sw: "ne",
    n: "s",
    s: "n",
    e: "w",
    w: "e",
};
/**
 * A shape with its coordinates rounded to whole pixels.
 *
 * Scaling multiplies by a ratio, so a resize that should land on 460 arrives
 * as 459.9999999999999 and is stored that way. It renders identically - the
 * canvas works in floats - but it reaches the database, the wire and every
 * collaborator, and it makes stored geometry awkward to read or compare.
 *
 * Applied where geometry is committed rather than inside scale(), so the
 * frames of a drag stay smooth: rounding every intermediate frame would make
 * a slow resize move in visible steps.
 */
export function roundShape(shape: Shape): Shape {
    const r = Math.round;
    if (shape.type === "circle") {
        return { ...shape, centerX: r(shape.centerX), centerY: r(shape.centerY), radius: r(shape.radius) };
    }
    if (shape.type === "rect" || shape.type === "image") {
        return { ...shape, x: r(shape.x), y: r(shape.y), width: r(shape.width), height: r(shape.height) };
    }
    if (shape.type === "text") {
        // fontSize keeps one decimal: whole pixels are too coarse a step for
        // type, and a half-point difference is visible at small sizes
        return {
            ...shape,
            x: r(shape.x),
            y: r(shape.y),
            fontSize: Math.round(shape.fontSize * 10) / 10,
        };
    }
    return { ...shape, points: shape.points.map((p) => ({ x: r(p.x), y: r(p.y) })) };
}

/**
 * Whether a shape is too small to be worth keeping.
 *
 * A click with a drawing tool is a drag of zero length, which produces a
 * zero-sized shape: invisible, but a real row in the database and a real entry
 * in the z-order, sitting above everything drawn before it and swallowing
 * clicks at that point. The damage is entirely out of proportion to the
 * mistake, so these are dropped rather than committed.
 *
 * Measured on the bounding box, so it covers every type at once - including a
 * pencil "stroke" of a single point.
 */
export function isDegenerate(shape: Shape): boolean {
    const b = boundsOf(shape);
    return b.right - b.left < MIN_SIZE && b.bottom - b.top < MIN_SIZE;
}

/**
 * The box a shape occupies on screen.
 *
 * Used by the appear animation today, and by the selection outline and resize
 * handles in the steps after this one - which is why it lives beside the hit
 * test rather than inside Game: it is the same geometry, asked a different way.
 */
export function boundsOf(shape: Shape): Bounds {
    switch (shape.type) {
        case "rect": {
            // width and height are signed: a rect dragged right-to-left stores
            // a negative width, so the corners need normalising
            return {
                left: Math.min(shape.x, shape.x + shape.width),
                right: Math.max(shape.x, shape.x + shape.width),
                top: Math.min(shape.y, shape.y + shape.height),
                bottom: Math.max(shape.y, shape.y + shape.height),
            };
        }
        case "circle": {
            const r = Math.abs(shape.radius);
            return {
                left: shape.centerX - r,
                right: shape.centerX + r,
                top: shape.centerY - r,
                bottom: shape.centerY + r,
            };
        }
        case "image": {
            // width and height are signed only in theory - images are placed,
            // not dragged out - but normalising costs nothing and keeps a
            // flipped resize from producing an inside-out box
            return {
                left: Math.min(shape.x, shape.x + shape.width),
                right: Math.max(shape.x, shape.x + shape.width),
                top: Math.min(shape.y, shape.y + shape.height),
                bottom: Math.max(shape.y, shape.y + shape.height),
            };
        }
        case "text": {
            const lineCount = shape.text.split("\n").length;
            return {
                left: shape.x,
                right: shape.x + widestLineWidth(shape.text, shape.fontSize, shape.fontFamily),
                top: shape.y,
                bottom: shape.y + shape.fontSize * LINE_HEIGHT * lineCount,
            };
        }
        default: {
            // pencil, line and arrow: the extent of their points
            const pts = shape.points;
            if (pts.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 };
            let left = pts[0].x, right = pts[0].x, top = pts[0].y, bottom = pts[0].y;
            for (const p of pts) {
                if (p.x < left) left = p.x;
                if (p.x > right) right = p.x;
                if (p.y < top) top = p.y;
                if (p.y > bottom) bottom = p.y;
            }
            return { left, top, right, bottom };
        }
    }
}
export function handlesOf(bounds: Bounds): Handle[] {
    const midX = (bounds.left + bounds.right) / 2;
    const midY = (bounds.top + bounds.bottom) / 2;
    // corners first: on a small shape the grips overlap, and handleAt returns
    // the first match, so the two-axis grip should win over the one-axis one
    return [
        { corner: "nw", x: bounds.left,  y: bounds.top },
        { corner: "ne", x: bounds.right, y: bounds.top },
        { corner: "se", x: bounds.right, y: bounds.bottom },
        { corner: "sw", x: bounds.left,  y: bounds.bottom },
        { corner: "n",  x: midX,         y: bounds.top },
        { corner: "s",  x: midX,         y: bounds.bottom },
        { corner: "w",  x: bounds.left,  y: midY },
        { corner: "e",  x: bounds.right, y: midY },
    ];
}

/**
 * The box containing every shape given, or null when given none.
 *
 * One selection of twenty shapes resizes as one object, so the handles and the
 * scale factors come from this rather than from any single shape.
 */
export function boundsUnion(shapes: Shape[]): Bounds | null {
    if (shapes.length === 0) return null;
    let union: Bounds | null = null;
    for (const shape of shapes) {
        const b = boundsOf(shape);
        union = union === null ? { ...b } : {
            left: Math.min(union.left, b.left),
            top: Math.min(union.top, b.top),
            right: Math.max(union.right, b.right),
            bottom: Math.max(union.bottom, b.bottom),
        };
    }
    return union;
}
/**
 * How far from a corner still counts as grabbing its handle, in pixels.
 *
 * Deliberately wider than half of HANDLE_SIZE. A press that misses a grip does
 * not do nothing - it lands inside the selection, which starts a *move*, so a
 * near miss silently drags the shape instead of resizing it. Being generous
 * here is what stops that. It also covers the gap left by the selection
 * outline's own padding, which puts the visible corner a few pixels outside
 * the grip drawn on it.
 */
const HANDLE_GRAB = 12;

/**
 * The handle under a point, or null.
 *
 * A square test, because a square is what gets drawn, sized by HANDLE_GRAB
 * rather than by the square itself: a grip you have to hit exactly is
 * miserable to use, and the slop costs nothing because handles sit at the
 * corners of a box rather than packed together.
 *
 * On a very small shape the four grips overlap and a press satisfies more than
 * one test; the first match wins, which the minimum size in resizeShape keeps
 * rare.
 */
export function handleAt(bounds: Bounds, point: Point): Handle | null {
    for (const handle of handlesOf(bounds)) {
        const grab = HANDLE_GRAB;
        if (Math.abs(point.x - handle.x) <= grab && Math.abs(point.y - handle.y) <= grab) {
            return handle;
        }
    }
    return null;
}


/**
 * The same shape, scaled about `anchor` by (sx, sy).
 *
 * Scaling about a point is three steps folded into one line per coordinate:
 * shift so the anchor is the origin, multiply, shift back.
 *
 *     p' = anchor + (p - anchor) * s
 *
 * Returns a new object and never writes into the one passed in, so a resize
 * can call it repeatedly against the pristine original cloned at mousedown -
 * recomputing from the original each frame rather than compounding per-frame
 * factors, which would drift.
 */
/**
 * How far along its own diagonal a grip has been dragged.
 *
 * For shapes that cannot stretch - a circle has one radius, a font one size -
 * two axis factors have to collapse into one, and *which* one decides how the
 * drag feels.
 *
 * Taking the smaller of the two is the obvious choice and a bad one. A text
 * box is typically wide and short, so a pixel of vertical movement is a far
 * bigger ratio than a pixel of horizontal movement; the minimum then throws
 * away almost all of the vertical drag, and worse, the axis in control can
 * swap part-way through. The size lurches and the corner never sits under the
 * pointer.
 *
 * Projecting the cursor onto the grip's original offset from the anchor gives
 * one number that moves continuously with the pointer, weights each axis by
 * how long the box actually is along it, and cannot flip. It is the standard
 * constrain-to-proportion behaviour, and it falls out correctly for edge
 * grips too: with one span zero, the projection reduces to the ratio along
 * the other axis.
 */
function uniformFactor(spanX: number, spanY: number, toX: number, toY: number): number {
    const lengthSquared = spanX * spanX + spanY * spanY;
    if (lengthSquared === 0) return 1;
    // magnitude only; mirroring is reapplied per axis by the caller, which
    // knows which way each one went
    return Math.abs((toX * spanX + toY * spanY) / lengthSquared);
}

/**
 * Split a single factor back into signed per-axis ones.
 *
 * `fx` and `fy` carry the magnitude with each axis's own direction, so a
 * mirrored drag still mirrors. Position and size must both be built from
 * these, or the corner meant to stay pinned drifts and the shape appears to
 * move while being resized.
 */
function uniform(sx: number, sy: number, factor?: number): { fx: number; fy: number; factor: number } {
    // the projection when the caller has one; otherwise the old rule, so a
    // caller that does not know about diagonals still behaves sanely
    const magnitude = factor ?? Math.min(Math.abs(sx), Math.abs(sy));
    return {
        fx: (sx < 0 ? -1 : 1) * magnitude,
        fy: (sy < 0 ? -1 : 1) * magnitude,
        factor: magnitude,
    };
}

export function scale(
    shape: Shape,
    anchor: Point,
    sx: number,
    sy: number,
    /** the diagonal projection, for the shapes that cannot stretch */
    uniformScale?: number
): Shape {
    const sizeX = (x: number) => anchor.x + (x - anchor.x) * sx;
    const sizeY = (y: number) => anchor.y + (y - anchor.y) * sy;

    if (shape.type === "circle") {
        // centerX/centerY/radius cannot describe an ellipse, so a non-uniform
        // drag has nowhere to go: the smaller factor wins, which keeps the
        // circle inside the box being dragged rather than spilling out of it.
        // True two-axis resizing would mean storing radiusX and radiusY.
        //
        // Both the centre and the radius must use that one factor. Moving the
        // centre by sx/sy while sizing the radius by the smaller of the two
        // makes the anchored corner drift, so the circle slides away from the
        // corner that is supposed to be pinned.
        const { fx, fy, factor } = uniform(sx, sy, uniformScale);
        return {
            ...shape,
            centerX: anchor.x + (shape.centerX - anchor.x) * fx,
            centerY: anchor.y + (shape.centerY - anchor.y) * fy,
            radius: Math.abs(shape.radius) * factor,
        };
    }
    if (shape.type === "rect" || shape.type === "image") {
        // per-axis, unlike text: an image has real pixels to stretch, and
        // drawImage will happily squash them. Constraining to the aspect ratio
        // would be friendlier, but it would also make an image the only shape
        // whose corner does not follow the cursor.
        return {
            ...shape,
            x: sizeX(shape.x),
            y: sizeY(shape.y),
            width: shape.width * sx,
            height: shape.height * sy,
        };
    }
    if (shape.type === "text") {
        // the glyphs scale, they do not stretch: a font has one size, which is
        // why fontSize is stored per shape. One factor for both axes, so the
        // box will not track the cursor exactly - text dimensions come from
        // font metrics, not from the drag.
        // Same one-factor rule as the circle, and for the same reason: sizing
        // the glyphs by one number while placing them with another lets the
        // anchored corner drift.
        const { fx, fy, factor } = uniform(sx, sy, uniformScale);
        const b = boundsOf(shape);
        const mapX = (x: number) => anchor.x + (x - anchor.x) * fx;
        const mapY = (y: number) => anchor.y + (y - anchor.y) * fy;
        // x,y is the top-left corner the glyphs run from, and glyphs cannot be
        // mirrored. Under a negative factor the box's two edges swap, so the
        // smaller mapped edge is taken rather than assuming x stays leftmost -
        // otherwise a flipped text would run off in the wrong direction.
        return {
            ...shape,
            x: Math.min(mapX(b.left), mapX(b.right)),
            y: Math.min(mapY(b.top), mapY(b.bottom)),
            fontSize: Math.max(1, shape.fontSize * factor),
        };
    }
    // pencil, line and arrow: every point moves, the same way
    return {
        ...shape,
        points: shape.points.map((p) => ({ x: sizeX(p.x), y: sizeY(p.y) })),
    };
}

/**
 * How much to scale, so that the dragged corner lands on `to` while the
 * opposite corner stays put.
 *
 * Factors rather than a finished shape, because a group resize applies the
 * same pair to every member: the box belongs to the selection, not to any one
 * shape. The degenerate cases are handled here so the mouse handler stays a
 * mouse handler.
 */
export function scaleFactors(
    bounds: Bounds,
    corner: Corner,
    anchor: Point,
    to: Point
): { sx: number; sy: number; uniform: number } {
    // Where the grabbed corner started, relative to the anchor. This is the
    // divisor, and its SIGN is the whole point: grabbing "nw" puts the corner
    // left of and above its anchor, so the offset is negative on both axes.
    // Dividing by a plain width instead would invert every drag from nw, ne
    // and sw - the shape would mirror the instant it was touched, stretching
    // away from the cursor.
    const grabbed = handlesOf(bounds).find((h) => h.corner === corner)!;
    // A zero-width box - a vertical line, a single-point stroke - would give an
    // infinite or NaN factor, and NaN coordinates render as nothing at all,
    // silently. Flooring the magnitude keeps the shape visible and scalable.
    const spanX = grabbed.x - anchor.x;
    const spanY = grabbed.y - anchor.y;

    return {
        // An edge grip sits directly above, below or beside its anchor, so on
        // the axis it does not move along the span is zero. That axis is not
        // being resized at all - it must come back as exactly 1, not as a
        // division by a floored span, which would quietly rescale the side the
        // person was holding still.
        sx: spanX === 0 ? 1 : atLeast(to.x - anchor.x, MIN_SIZE) / spanX,
        sy: spanY === 0 ? 1 : atLeast(to.y - anchor.y, MIN_SIZE) / spanY,
        uniform: uniformFactor(spanX, spanY, to.x - anchor.x, to.y - anchor.y),
    };
}

/**
 * `delta` with its sign kept and its magnitude floored at `min`.
 *
 * Keeping the sign is what lets a handle be dragged *through* its anchor and
 * out the far side: numerator and divisor then disagree, the factor goes
 * negative, and the shape mirrors rather than stopping dead at the anchor.
 * The floor means crossing over passes through a small shape instead of a
 * zero-sized one that could never be grabbed again.
 *
 * Exactly zero has no sign to preserve, so it is treated as positive.
 */
function atLeast(delta: number, min: number): number {
    const sign = delta < 0 ? -1 : 1;
    return sign * Math.max(Math.abs(delta), min);
}

/**
 * The same shape, moved by (dx, dy).
 *
 * Returns a new object and never writes into the one passed in, so a drag can
 * call it repeatedly against the pristine original it cloned at mousedown.
 *
 * A move is the same offset applied to every position a shape has: a circle
 * has one (its centre), rect and text one (their top-left), and the three
 * point-based types have as many as were drawn.
 */
/**
 * The topmost shape whose *interior* contains the point, or null.
 *
 * hitTest matches outlines, which is right for the eraser and for grabbing a
 * thin line - but it means a press in the middle of a rectangle hits nothing.
 * Selecting is the one place where the inside of a shape should count, so this
 * is tried as a fallback there.
 *
 * Closed shapes only. A pencil stroke, line or arrow has no inside, and
 * treating its bounding box as one would swallow presses nowhere near it.
 */
export function hitTestInside(shapes: Shape[], point: Point): Shape | null {
    for (let i = shapes.length - 1; i >= 0; i--) {
        const shape = shapes[i];
        if (!shape) continue;
        if (shape.type === "rect") {
            if (rectangleCollision(point, shape.x, shape.y, shape.width, shape.height, 0)) {
                return shape;
            }
        } else if (shape.type === "circle") {
            // the disc, not the ring: the bounding square would also match its
            // corners, which are visibly outside the shape
            if (Math.hypot(point.x - shape.centerX, point.y - shape.centerY) <= Math.abs(shape.radius)) {
                return shape;
            }
        } else if (shape.type === "text" || shape.type === "image") {
            // both are solid rectangles: unlike a stroked shape there is no
            // outline to aim at, and clicking the middle of a photo obviously
            // means that photo
            const b = boundsOf(shape);
            if (point.x >= b.left && point.x <= b.right && point.y >= b.top && point.y <= b.bottom) {
                return shape;
            }
        }
    }
    return null;
}

/** The box between two dragged corners, with the corners in any order. */
export function boundsBetween(from: Point, to: Point): Bounds {
    return {
        left: Math.min(from.x, to.x),
        right: Math.max(from.x, to.x),
        top: Math.min(from.y, to.y),
        bottom: Math.max(from.y, to.y),
    };
}

/**
 * Every shape whose box overlaps `area`, in list order.
 *
 * Touching counts: a marquee that clips the edge of a shape selects it, which
 * is what Excalidraw does and is far more forgiving than requiring a shape to
 * be enclosed completely.
 */
export function shapesInBounds(shapes: Shape[], area: Bounds): Shape[] {
    return shapes.filter((shape) => {
        const b = boundsOf(shape);
        return (
            b.left <= area.right &&
            b.right >= area.left &&
            b.top <= area.bottom &&
            b.bottom >= area.top
        );
    });
}

export function translate(shape: Shape, dx: number, dy: number): Shape {
    if (shape.type === "circle") {
        // a circle is positioned entirely by its centre - the radius does not
        // move, so a spread of the flat number fields is a complete copy
        return { ...shape, centerX: shape.centerX + dx, centerY: shape.centerY + dy };
    }
    if(shape.type === "rect" || shape.type ==="text" || shape.type === "image") {
        return {...shape, x:shape.x+dx, y:shape.y+dy };
    }
    if(shape.type=== "pencil" || shape.type === "line" || shape.type === "arrow") {
       const points:Point[] = shape.points
       const newPoints = points.map((p) => ({
        x:p.x+ dx,
        y:p.y+dy
       }))
       return {...shape, points:newPoints}
    }

    return shape;
}

export function hitTest(shapes: Shape[], point: Point, tolerance: number) : Shape | null {
    let hit = false;
    for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape.type === "circle") {
        hit = circleCollision(point, shape.centerX, shape.centerY, shape.radius, tolerance);  
        if(hit ===true) {
            return shape
        } 
    } else if(shape.type === "text") {
        const lineCount = shape.text.split("\n").length
        const width  = widestLineWidth(shape.text, shape.fontSize, shape.fontFamily)
        const height = shape.fontSize * LINE_HEIGHT * lineCount
        hit = rectangleCollision(point, shape.x, shape.y, width, height, tolerance)
        if(hit ===true) {
            return shape
        }
    }
    else if (shape.type === "rect") {
        // outline only, like the circle: rects are unfilled, so a point in
        // the empty middle is not touching anything
        hit = rectangleOutlineCollision(point, shape.x, shape.y, shape.width, shape.height, tolerance)
        if(hit ===true) {
            return shape
        } 
    }
    else if (shape.type === "image") {
        // solid, not an outline: an image is opaque pixels, so touching any
        // part of it counts - for the eraser as much as for selection
        hit = rectangleCollision(point, shape.x, shape.y, shape.width, shape.height, tolerance)
        if (hit === true) {
            return shape
        }
    }
    else {
        // pencil, line and arrow - the only types left, and the only ones with
        // a points array
        const pts = shape.points;
        for (let j = 1; j < pts.length; j++) {
            if (segmentCollision(pts[j - 1], pts[j], point, tolerance)) {
              return shape;        
            }
          }
    }
}
return null;
}

/**
 * Width of the widest line of a text shape, in pixels.
 *
 * Glyph widths depend on the font, so the only accurate source is measureText.
 * The canvas below is never added to the page - it exists purely to hold a 2D
 * context that can measure, and one is created for the life of the tab.
 *
 * The font string must match what renderer.text() draws with, or the box will
 * not agree with what is on screen.
 */
let measurer: CanvasRenderingContext2D | null = null;

function widestLineWidth(text: string, fontSize: number, fontFamily: string) {
    if (!measurer) {
        measurer = document.createElement("canvas").getContext("2d");
    }

    const lines = text.split("\n");
    if (!measurer) {
        const longest = Math.max(...lines.map((line) => line.length));
        return longest * fontSize * 0.55;
    }
    measurer.font = `${fontSize}px ${fontFamily}`;
    return Math.max(...lines.map((line) => measurer!.measureText(line).width));
}

function circleCollision(p:Point, centerX:number, centerY: number, radius:number, t: number) {
    const d = Math.hypot(p.x - centerX, p.y -centerY);
    return Math.abs(d - Math.abs(radius)) <= t;
}
function rectangleCollision(p:Point, x:number, y:number, width:number, height:number, t:number ) {
    const left   = Math.min(x, x + width);
    const right  = Math.max(x, x + width);
    const top    = Math.min(y, y + height);
    const bottom = Math.max(y, y + height);
    return p.x >= left - t && p.x <= right + t && p.y >= top - t  && p.y <= bottom + t;
}
/** within t of any edge: inside the box grown by t, but not inside it shrunk by t */
function rectangleOutlineCollision(p:Point, x:number, y:number, width:number, height:number, t:number) {
    if (!rectangleCollision(p, x, y, width, height, t)) return false;
    const left   = Math.min(x, x + width);
    const right  = Math.max(x, x + width);
    const top    = Math.min(y, y + height);
    const bottom = Math.max(y, y + height);
    const insideInner = p.x > left + t && p.x < right - t && p.y > top + t && p.y < bottom - t;
    return !insideInner;
}
function segmentCollision(a:Point,b:Point ,p:Point, t:number) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y) <= t;
    let u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
    u = Math.max(0, Math.min(1, u));
    const cx = a.x + u * dx;
    const cy = a.y + u * dy;
    return Math.hypot(p.x - cx, p.y - cy) <= t;
}