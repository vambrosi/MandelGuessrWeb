// ------------------------------------------------------------------------------------- //
// Globals
// ------------------------------------------------------------------------------------- //
import roots from './roots.js';

function $id(element) { return document.getElementById(element)}

const WASM_PAGE_SIZE = 1024 * 64;
const PALETTE_PAGES = 2;
const CANVAS_SIZE = 500;
const MAX_ITERS = 500;

let guess = [0.0, 0.0];
let points = 0;
let madeGuess = false;

const clueCanvas = $id("clueCanvas")
const guessCanvas = $id("guessCanvas")
const pointsSpan = $id("points");
const pointsAddedSpan = $id("pointsAdded");
const spacebarColumn = $id("spacebarColumn");
const periodSelect = $id("periodSelect");
const randomOrderCheck = $id("randomOrderCheck");

let currentClueIndices = {};
for (let [period, rootList] of Object.entries(roots)) {
    currentClueIndices[period] = rootList.length;
}
let clue = newClue(periodSelect.value);

// ------------------------------------------------------------------------------------- //
// Views
// ------------------------------------------------------------------------------------- //

class View {
    // View parameters
    center;
    PPU;
    initCenter;
    initPPU;
    xlims;
    ylims;
    isClue;

    // Canvas variables
    canvas;
    ctx;
    img;

    // Buffer canvas
    bufferCanvas;
    bufferCtx;

    // Pointer coordinates
    pointerCanvas;
    pointerOn;
    scale;
    isZooming;

    // Drag coordinates
    dragged;
    dragStartCanvas;
    translationComplex;

    // WASM functions and memory
    wasmMem;
    wasmMem8;
    wasmShared;
    wasmObj;

    constructor(canvas, center, diameter, isClue) {
        this.center = [...center];
        this.initCenter = [...center];
        this.PPU = CANVAS_SIZE / diameter;
        this.initPPU = CANVAS_SIZE / diameter;

        const maxRadius = diameter / 2;
        this.xlims = [this.initCenter[0] - maxRadius, this.initCenter[0] + maxRadius];
        this.ylims = [this.initCenter[1] - maxRadius, this.initCenter[1] + maxRadius];

        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");

        this.isClue = isClue;

        this.scale = 1;
        this.isZooming = false;

        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;

        this.bufferCanvas = document.createElement("canvas");
        this.bufferCanvas.width = canvas.width;
        this.bufferCanvas.height = canvas.height;
        this.bufferCtx = this.bufferCanvas.getContext("2d");
        this.img = this.bufferCtx.createImageData(canvas.width, canvas.height);
        const pages = Math.ceil(this.img.data.length / WASM_PAGE_SIZE);

        this.wasmMem = new WebAssembly.Memory({ initial: pages + PALETTE_PAGES });
        this.wasmMem8 = new Uint8ClampedArray(this.wasmMem.buffer);
        this.wasmShared = {
            math: { log2: Math.log2 },
            js: {
                shared_mem: this.wasmMem,
                image_offset: 0,
                palette_offset: WASM_PAGE_SIZE * pages
            },
        }

        this.dragged = false;
        this.pointerOn = false;

        this.canvas.addEventListener("mousemove", this.mouseTrack(this), false);
        this.canvas.addEventListener("mousedown", this.dragHandler(this), false);
        this.canvas.addEventListener("mouseover", this.mouseOver(this, true), false);
        this.canvas.addEventListener("mouseout", this.mouseOver(this, false), false);
        this.canvas.addEventListener("wheel", this.wheelZoom(this), false);
    }

    async initialize() {
        this.wasmObj = await WebAssembly.instantiateStreaming(
            fetch("./wat/plot.wasm"),
            this.wasmShared
        );
        this.wasmObj.instance.exports.gen_palette();
        this.update();
    }

    reset(center, diameter) {
        this.center = [...center];
        this.initCenter = [...center];
        this.PPU = CANVAS_SIZE / diameter;
        this.initPPU = CANVAS_SIZE / diameter;

        const maxRadius = diameter / 2;
        this.xlims = [this.initCenter[0] - maxRadius, this.initCenter[0] + maxRadius];
        this.ylims = [this.initCenter[1] - maxRadius, this.initCenter[1] + maxRadius];
    }

    // Plotting functions

    update(bounded = true) {
        if (bounded) this.moveToBounds();

        this.wasmObj.instance.exports.mandel_plot(
            CANVAS_SIZE, CANVAS_SIZE, this.center[0], this.center[1], this.PPU, MAX_ITERS
        );
        this.img.data.set(this.wasmMem8.slice(0, this.img.data.length));
        this.redraw();
    }

    moveToBounds() {
        const currentRadius = CANVAS_SIZE / (2 * this.PPU);

        const xLow = this.xlims[0] + currentRadius;
        const xHigh = this.xlims[1] - currentRadius;
        const yLow = this.ylims[0] + currentRadius;
        const yHigh = this.ylims[1] - currentRadius;

        this.center[0] = Math.max(xLow, Math.min(xHigh, this.center[0]));
        this.center[1] = Math.max(yLow, Math.min(yHigh, this.center[1]));
    }

    redraw(corner = [0, 0]) {
        this.bufferCtx.putImageData(this.img, 0, 0);

        if (madeGuess) {
            const guessCircle = new Path2D();
            const guessCanvasCoord = this.complexToCanvas(guess);
            guessCircle.arc(guessCanvasCoord[0], guessCanvasCoord[1], 5, 0, 2 * Math.PI);

            const clueCircle = new Path2D();
            const clueCanvasCoord = this.complexToCanvas(clue.z);
            clueCircle.arc(clueCanvasCoord[0], clueCanvasCoord[1], 5, 0, 2 * Math.PI);

            this.bufferCtx.fillStyle = "red";
            this.bufferCtx.fill(guessCircle);
            this.bufferCtx.fill(clueCircle);

            this.bufferCtx.strokeStyle = "red";
            this.bufferCtx.beginPath();
            this.bufferCtx.moveTo(clueCanvasCoord[0], clueCanvasCoord[1]);
            this.bufferCtx.lineTo(guessCanvasCoord[0], guessCanvasCoord[1]);
            this.bufferCtx.stroke();
        }

        this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        this.ctx.drawImage(this.bufferCanvas, corner[0], corner[1]);
    }

    // Coordinate changes

    canvasToComplex(point) {
        const real = this.center[0] + (point[0] - CANVAS_SIZE / 2) / this.PPU;
        const imag = this.center[1] - (point[1] - CANVAS_SIZE / 2) / this.PPU;
        return [real, imag];
    }

    complexToCanvas(z) {
        const x = CANVAS_SIZE / 2 + this.PPU * (z[0] - this.center[0]);
        const y = CANVAS_SIZE / 2 - this.PPU * (z[1] - this.center[1]);
        return [x, y];
    }

    // Event handlers

    mouseTrack(view) {
        return (event) => {
            view.pointerCanvas = eventClampedPos(event);
            let pointerComplex = view.canvasToComplex(view.pointerCanvas);

            if (!view.isClue) {
                $id("pointerX").innerHTML = Number.parseFloat(
                    pointerComplex[0]
                ).toFixed(16);
                $id("pointerY").innerHTML = Number.parseFloat(
                    pointerComplex[1]
                ).toFixed(16);
            }

            if (view.dragStartCanvas) {
                view.dragged = true;
                let dragStartComplex = view.canvasToComplex(view.dragStartCanvas);

                let translationCanvas = subVector(
                    view.pointerCanvas,
                    view.dragStartCanvas
                );

                view.translationComplex = subVector(
                    dragStartComplex,
                    pointerComplex
                  );

                view.redraw(translationCanvas);
            };
        };
    }

    dragHandler(view) {
        return (event) => {
            if (event.button == 0) {
                view.dragStartCanvas = eventClampedPos(event);
                view.dragged = false;
            };
        };
    }

    mouseOver(view, isOver) {
        return (event) => { view.pointerOn = isOver; }
    }

    wheelZoom(view) {
        return (event) => {
            event.preventDefault();
            let pointerComplex = view.canvasToComplex(view.pointerCanvas);

            view.scale += event.deltaY * -0.01;
            view.scale = Math.min(Math.max(0.02, view.scale), 50);
            view.scale = Math.max(view.initPPU / view.PPU, view.scale)

            view.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            view.ctx.translate(view.pointerCanvas[0], view.pointerCanvas[1]);
            view.ctx.scale(view.scale, view.scale);
            view.ctx.translate(-view.pointerCanvas[0], -view.pointerCanvas[1]);
            view.redraw();

            view.ctx.setTransform(1, 0, 0, 1, 0, 0);
            window.clearTimeout(view.isZooming);

            view.isZooming = setTimeout(() => {
                view.PPU *= view.scale;
                view.center = addVector(
                    multVector(1 / view.scale, view.center),
                    multVector(1 - 1 / view.scale, pointerComplex)
                );
                view.update();
                view.scale = 1;
            }, 100);
        };
    }
}

const clueView = new View(clueCanvas, clue.z, clue.diam, true);
const guessView = new View(guessCanvas, [-0.5, 0.0], 4.0, false);

clueView.initialize();
guessView.initialize();
guessCanvas.focus({ focusVisible: false });

document.addEventListener("mouseup", dragHandler, false);
document.addEventListener("keydown", keyHandler, false);

// ------------------------------------------------------------------------------------- //
// Event Listeners
// ------------------------------------------------------------------------------------- //

const offsetToClampedPos = (offset, dim, offsetDim) => {
    let pos = offset - (offsetDim - dim) / 2;
    return pos < 0 ? 0 : pos > dim ? dim : pos;
  };

const eventClampedPos = (event) => {
    const x = offsetToClampedPos(
        event.offsetX,
        event.target.width,
        event.target.offsetWidth
    );
    const y = offsetToClampedPos(
        event.offsetY,
        event.target.height,
        event.target.offsetHeight
    );
    return [x, y];
};

function dragHandler(event) {
    if (event.button == 0) {
        for (let view of [clueView, guessView]) {
            if (view.dragged) {
                view.center = addVector(view.center, view.translationComplex);
                view.update();
            }

            view.dragStartCanvas = null;
            view.dragged = false;
        }
    }
}

function keyHandler(event) {
    if (event.key == "r" || event.key == " ") {
        event.preventDefault();
    }

    if (event.key == " " && madeGuess) {
        newTurn();
        return
    }

    const view = guessView.pointerOn
        ? guessView
        : clueView.pointerOn
        ? clueView
        : null;
    if (!view) {
        return;
    }

    switch (event.key) {
        case "r":
            resetView(view)
            break;
        case " ":
            if (!madeGuess && guessView.pointerOn) endTurn();
            break
    }
}

function resetView(view) {
    view.center = [...view.initCenter];
    view.PPU = view.initPPU;
    view.update(false);
}

// ------------------------------------------------------------------------------------- //
// Game related functions
// ------------------------------------------------------------------------------------- //

function getClue(periodString, index) {
    const root = roots[periodString][index];
    return {z: [root.x, root.y], diam: root.diam}
}

function newClue(periodString) {
    let period = parseInt(periodString);

    while (currentClueIndices[period] == 0 && period < 16) {
        period = period == 6 ? 8 : period == 13 ? 16 : period + 1;
        periodSelect.value = String(period);
    }
    periodString = String(period);
    currentClueIndices[periodString] -= 1

    const i = currentClueIndices[periodString];
    let j = i;

    if (randomOrderCheck.checked) {
        j = Math.floor(Math.random() * (i + 1));
        [roots[periodString][i], roots[periodString][j]] =
            [roots[periodString][j], roots[periodString][i]];
    }

    return getClue(periodString, i)
}

function addPoints(distance) {
    const maxThreshold = 2.0 - Math.log2(clue.diam);
    const r = Math.max(2.0 - Math.log2(distance), 0.0);
    const extraPoints = Math.min(Math.round(900 * r / maxThreshold + 100), 1000);
    points += extraPoints;
    return extraPoints
}


function endTurn() {
    guess = guessView.canvasToComplex(guessView.pointerCanvas)
    madeGuess = true;

    $id('rootX').innerHTML = Number.parseFloat(clue.z[0]).toFixed(16);
    $id('rootY').innerHTML = Number.parseFloat(clue.z[1]).toFixed(16);

    const d = distance(clue.z, guess);
    pointsSpan.innerHTML = Number.parseInt(points);
    pointsAddedSpan.innerHTML = " + " + Number.parseInt(addPoints(d)) + " (of 1000)";
    spacebarColumn.innerHTML = "Space Bar -> Try Again!";
    spacebarColumn.style.color = "red";

    guessView.PPU = Math.min(CANVAS_SIZE / (2 * d), clueView.PPU);
    guessView.center = midpoint(clue.z, guess);

    resetView(clueView);
    guessView.update(false);
}

function newTurn(render = true) {
    madeGuess = false;

    $id('rootX').innerHTML = "?.????????????????";
    $id('rootY').innerHTML = "?.????????????????";

    pointsSpan.innerHTML = Number.parseInt(points);
    pointsAddedSpan.innerHTML = "";
    spacebarColumn.innerHTML = "Space Bar -> Pick Guess";
    spacebarColumn.style.color = "black";

    clue = newClue(periodSelect.value);

    guessView.center = guessView.initCenter;
    guessView.PPU = guessView.initPPU;

    clueView.reset(clue.z, clue.diam);

    if (render) {
        guessView.update(false);
        clueView.update(false);
    }
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

// ------------------------------------------------------------------------------------- //
// Menu Functions
// ------------------------------------------------------------------------------------- //

const menu = document.querySelector(".menu");
const menuItems = document.querySelectorAll(".menuItem");
const hamburger = document.querySelector(".hamburger");
const closeIcon = document.querySelector(".closeIcon");
const menuIcon = document.querySelector(".menuIcon");

function toggleMenu() {
  if (menu.classList.contains("showMenu")) {
    menu.classList.remove("showMenu");
    closeIcon.style.display = "none";
    menuIcon.style.display = "block";
  } else {
    menu.classList.add("showMenu");
    closeIcon.style.display = "block";
    menuIcon.style.display = "none";
  }
}

hamburger.addEventListener("click", toggleMenu);