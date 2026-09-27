import { LINE_HEIGHT, Point } from "./renderer";
import { Shape } from "./Game";

export type Bounds = { left: number; top: number; right: number; bottom: number };

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
        hit = rectangleCollision(point, shape.x, shape.y, shape.width, shape.height, tolerance)
        if(hit ===true) {
            return shape
        } 
    } 
    else {
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