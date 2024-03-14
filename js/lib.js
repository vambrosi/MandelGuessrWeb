// ------------------------------------------------------------------------------------- //
// Globals
// ------------------------------------------------------------------------------------- //

function $id(element) { return document.getElementById(element) }

const WASM_PAGE_SIZE = 1024 * 64;
const PALETTE_PAGES = 2;
const CANVAS_SIZE = 500;

const MAX_PPU = 1e16;
const MIN_PPU = CANVAS_SIZE / 4;

const DEFAULT_CENTER = [-0.5, 0.0];
const DEFAULT_DIAMETER = 4.0;
const MAX_ITERS = 500;

const rootsPromise = fetch("./assets/periods2-16.json").then(response => response.json());
let currentRootIndex = {2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 16: 0};

const periodSelect = $id("periodSelect");
let period = parseInt(periodSelect.value);

periodSelect.addEventListener("change", (e) => {
    if (insideNewClue) { return };

    period = parseInt(periodSelect.value);
    firstSpace = false;
    newClue();
});
let firstSpace = true;
let insideNewClue = false;

let complexPointer = [-0.5, 0.0];
let guess = [-0.185373633017024, -1.02656173723257];
let clue = {
    z: [-0.185373633017024, -1.02656173723257],
    diam: 1e-10,
};

let canvasPointer = [CANVAS_SIZE / 2, CANVAS_SIZE / 2];
let mouseOn = false;
let points = 0;
let madeGuess = false;
let clueIndex = 0;

const pointsSpan = $id("points");
const pointsAddedSpan = $id("pointsAdded");
const spacebarColumn = $id("spacebarColumn");

// ------------------------------------------------------------------------------------- //
// Plots
// ------------------------------------------------------------------------------------- //

class MandelView {
    center
    init_center
    ppu

    canvas
    ctx
    img

    showAnswer

    wasmMem
    wasmMem8
    wasmShared
    wasmObj

    constructor(
        canvas, center = DEFAULT_CENTER, diameter = DEFAULT_DIAMETER, showAnswer = false
    ) {
        this.center = [...center];
        this.init_center = [...center];
        this.ppu = CANVAS_SIZE / diameter;
        this.canvas = canvas;
        this.showAnswer = showAnswer;

        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;

        this.ctx = canvas.getContext("2d");
        this.img = this.ctx.createImageData(canvas.width, canvas.height);
        const pages = Math.ceil(this.img.data.length / WASM_PAGE_SIZE);

        this.wasmMem = new WebAssembly.Memory({ initial: pages + PALETTE_PAGES });
        this.wasmMem8 = new Uint8ClampedArray(this.wasmMem.buffer);
        this.wasmShared = {
            math: { log2: Math.log2 },
            js: {
                shared_mem: this.wasmMem,
                image_offset: 0,
                palette_offset: WASM_PAGE_SIZE * pages
            }
        };
    }

    async initialize(update=true) {
        this.wasmObj = await WebAssembly.instantiateStreaming(
            fetch("./wat/plot.wasm"),
            this.wasmShared
        );
        this.wasmObj.instance.exports.gen_palette();

        if (!update) { return };
        this.update();
    }

    update() {
        this.wasmObj.instance.exports.mandel_plot(
            CANVAS_SIZE, CANVAS_SIZE, this.center[0], this.center[1], this.ppu, MAX_ITERS
        );
        this.img.data.set(this.wasmMem8.slice(0, this.img.data.length));
        this.redraw([0, 0]);
    }

    redraw(corner) {
        this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        this.ctx.putImageData(this.img, corner[0], corner[1]);

        if (!this.showAnswer) { return }

        const guessCircle = new Path2D();
        const guessCanvasCoord = addVector(corner, this.complexToCanvas(guess));
        guessCircle.arc(guessCanvasCoord[0], guessCanvasCoord[1], 5, 0, 2 * Math.PI);

        const clueCircle = new Path2D();
        const clueCanvasCoord = addVector(corner, this.complexToCanvas(clue.z));
        clueCircle.arc(clueCanvasCoord[0], clueCanvasCoord[1], 5, 0, 2 * Math.PI);

        this.ctx.fillStyle = "red";
        this.ctx.fill(guessCircle);
        this.ctx.fill(clueCircle);

        this.ctx.strokeStyle = "red";
        this.ctx.beginPath();
        this.ctx.moveTo(clueCanvasCoord[0], clueCanvasCoord[1]);
        this.ctx.lineTo(guessCanvasCoord[0], guessCanvasCoord[1]);
        this.ctx.stroke();
    }

    canvasToComplex(point) {
        const real = this.center[0] + (point[0] - CANVAS_SIZE / 2) / this.ppu;
        const imag = this.center[1] - (point[1] - CANVAS_SIZE / 2) / this.ppu;
        return [real, imag]
    }

    complexToCanvas(z) {
        const x = CANVAS_SIZE / 2 + this.ppu * (z[0] - this.center[0]);
        const y = CANVAS_SIZE / 2 - this.ppu * (z[1] - this.center[1]);
        return [x, y]
    }
}

const clueView = new MandelView($id("clueCanvas"), clue.z, clue.diam, true);
const guessView = new MandelView($id("guessCanvas"));
guessCanvas.focus({ focusVisible: false });

clueView.initialize(false);
guessView.initialize();

clueView.ctx.font = "20px Space Mono";
clueView.ctx.textAlign = "center";
clueView.ctx.fillText("Press SPACE to start!", CANVAS_SIZE / 2, CANVAS_SIZE / 2);

// ------------------------------------------------------------------------------------- //
// Event Listeners
// ------------------------------------------------------------------------------------- //

let canvasDragStart, complexDragStart, canvasTranslation, complexTranslation, dragged;

const offsetToClampedPos = (offset, dim, offsetDim) => {
    let pos = offset - ((offsetDim - dim) /  2);
    return pos < 0 ? 0 : pos > dim ? dim : pos
}

const eventClampedPos = (event) => {
    const x = offsetToClampedPos(event.offsetX, event.target.width, event.target.offsetWidth);
    const y = offsetToClampedPos(event.offsetY, event.target.height, event.target.offsetHeight);
    return [x, y]
}

const mouse_track = (event) => {
    canvasPointer = eventClampedPos(event);
    complexPointer = guessView.canvasToComplex(canvasPointer);

    $id('x_complex_coord').innerHTML = Number.parseFloat(complexPointer[0]).toFixed(16);
    $id('y_complex_coord').innerHTML = Number.parseFloat(complexPointer[1]).toFixed(16);

    dragged = true;
    if (canvasDragStart) {
        canvasTranslation = subVector(canvasPointer, canvasDragStart);
        complexTranslation = subVector(complexDragStart, complexPointer);

        guessView.redraw(canvasTranslation);
    }
}

const zoom = zoomIn => event => {
    if (!zoomIn) event.preventDefault()

    const pointer = guessView.canvasToComplex(eventClampedPos(event));
    guessView.center = zoomIn
        ? midpoint(guessView.center, pointer)
        : subVector(multVector(2, guessView.center), pointer);

    guessView.ppu = zoomIn
        ? (new_ppu => new_ppu > MAX_PPU ? MAX_PPU : new_ppu)(guessView.ppu * 2)
        : (new_ppu => new_ppu < MIN_PPU ? MIN_PPU : new_ppu)(guessView.ppu / 2);

    if (guessView.ppu === MIN_PPU) { guessView.center = [...guessView.init_center] }

    guessView.update();
}

const spaceHandler = (event) => {
    if (firstSpace) {
        return
    }

    if (event.key == " " && mouseOn && !madeGuess) {
        guess = [...complexPointer];
        madeGuess = true;

        $id('solution_x').innerHTML = Number.parseFloat(clue.z[0]).toFixed(16);
        $id('solution_y').innerHTML = Number.parseFloat(clue.z[1]).toFixed(16);

        const d = distance(clue.z, guess);
        pointsSpan.innerHTML = Number.parseInt(points);
        pointsAddedSpan.innerHTML = " + " + Number.parseInt(addPoints(d));
        spacebarColumn.innerHTML = "Space Bar -> Try Again!";
        spacebarColumn.style.color = "red";

        guessView.ppu = Math.min(CANVAS_SIZE / (2 * d), clueView.ppu);
        guessView.center = midpoint(clue.z, guess);
        guessView.showAnswer = true;

        guessView.update();
        currentRootIndex[period] += 1;

    } else if (event.key == " " && madeGuess) {
        newClue();
    }
}

const firstSpaceHandler = (event) => {
    if (firstSpace && event.key == " ") {
        firstSpace = false;
        newClue();
    }
}

const dragHandler = (pressed) => (event) => {
    if (event.button != 0) { return }
    if (!pressed) {
        if (dragged && complexTranslation) {
            guessView.center = addVector(guessView.center, complexTranslation);
            guessView.update();
        } else if (mouseOn && !dragged && !event.ctrlKey) {
            zoom(true)(event);
        }

        canvasDragStart = null;
        complexDragStart = null;
        canvasTranslation = null;
        complexTranslation = null;
        return
    }

    canvasDragStart = eventClampedPos(event);
    complexDragStart = guessView.canvasToComplex(canvasDragStart);
    dragged = false;
}

guessView.canvas.addEventListener("mousemove", mouse_track, false);
guessView.canvas.addEventListener("mousedown", dragHandler(true), false);
document.addEventListener("mouseup", dragHandler(false), false);
document.addEventListener("keydown", firstSpaceHandler, false)
guessView.canvas.addEventListener('contextmenu', zoom(false), false);
guessView.canvas.addEventListener("mouseover", (event) => { mouseOn = true });
guessView.canvas.addEventListener("mouseleave", (event) => { mouseOn = false });
guessView.canvas.addEventListener("keydown", spaceHandler, false);

// ------------------------------------------------------------------------------------- //
// Game related functions
// ------------------------------------------------------------------------------------- //

function addPoints(distance) {
    const maxThreshold = 2.0 - Math.log2(clue.diam);
    const r = Math.max(2.0 - Math.log2(distance), 0.0);
    const extraPoints = Math.min(Math.round(900 * r / maxThreshold + 100), 1000);
    points += extraPoints;
    return extraPoints
}

async function newClue() {
    madeGuess = false;
    insideNewClue = true;

    $id('solution_x').innerHTML = "?.????????????????";
    $id('solution_y').innerHTML = "?.????????????????";

    pointsSpan.innerHTML = Number.parseInt(points);
    pointsAddedSpan.innerHTML = "";
    spacebarColumn.innerHTML = "Space Bar -> Pick Guess";
    spacebarColumn.style.color = "black";

    roots = await rootsPromise;

    while (currentRootIndex[period] == roots[period].length) {
        period = period == 6 ? 8 : period == 13 ? 16 : period + 1;
        periodSelect.value = String(period);
    }

    const root = roots[period][currentRootIndex[period]];

    clue.z[0] = root.x;
    clue.z[1] = root.y;
    clue.diam = root.diam;
    guess = [...clue.z];

    guessView.showAnswer = false;
    guessView.ppu = MIN_PPU;
    guessView.center = [...guessView.init_center];
    guessView.update();

    clueView.ppu = CANVAS_SIZE / clue.diam;
    clueView.center = [...clue.z];
    clueView.update();

    guessCanvas.focus({ focusVisible: false });
    insideNewClue = false;
}


// ------------------------------------------------------------------------------------- //
// Vector Operations
// ------------------------------------------------------------------------------------- //

function addVector(v1, v2) {
    return v1.map((e, i) => e + v2[i])
}

function subVector(v1, v2) {
    return v1.map((e, i) => e - v2[i])
}

function multVector(c, v) {
    return v.map((e, i) => c * e)
}

function distance(v1, v2) {
    return Math.sqrt((v1[0] - v2[0]) ** 2 + (v1[1] - v2[1]) ** 2)
}

function midpoint(v1, v2) {
    return multVector(0.5, addVector(v1, v2))
}