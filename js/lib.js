// ------------------------------------------------------------------------------------- //
// Globals
// ------------------------------------------------------------------------------------- //

function $id(element) { return document.getElementById(element) }

const WASM_PAGE_SIZE = 1024 * 64
const PALETTE_PAGES = 2
const CANVAS_SIZE = 500

const MAX_PPU = 1e16
const MIN_PPU = CANVAS_SIZE / 4

const DEFAULT_CENTER = [-0.5, 0.0]
const DEFAULT_DIAMETER = 4.0
const MAX_ITERS = 500

let pointer = [0.0, 0.0]
let guess = [-1.44754274928015, 0.00505100133824678]
let clue = {
    z: [-1.44754274928015, 0.00505100133824678],
    diam: 0.0003013761759231517,
}
let mouseOn = false
let points = 0
let madeGuess = false

const pointsSpan = $id("points")
const pointsAddedSpan = $id("pointsAdded")

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
        this.center = [...center]
        this.init_center = [...center]
        this.ppu = CANVAS_SIZE / diameter
        this.canvas = canvas
        this.showAnswer = showAnswer

        canvas.width = CANVAS_SIZE
        canvas.height = CANVAS_SIZE

        this.ctx = canvas.getContext("2d")
        this.img = this.ctx.createImageData(canvas.width, canvas.height)
        const pages = Math.ceil(this.img.data.length / WASM_PAGE_SIZE)

        this.wasmMem = new WebAssembly.Memory({ initial: pages + PALETTE_PAGES })
        this.wasmMem8 = new Uint8ClampedArray(this.wasmMem.buffer)
        this.wasmShared = {
            math: { log2: Math.log2 },
            js: {
                shared_mem: this.wasmMem,
                image_offset: 0,
                palette_offset: WASM_PAGE_SIZE * pages
            }
        }
    }

    async initialize() {
        this.wasmObj = await WebAssembly.instantiateStreaming(
            fetch("./wat/plot.wasm"),
            this.wasmShared
        )
        this.wasmObj.instance.exports.gen_palette()
        this.update()
    }

    update() {
        this.wasmObj.instance.exports.mandel_plot(
            CANVAS_SIZE, CANVAS_SIZE, this.center[0], this.center[1], this.ppu, MAX_ITERS
        )
        this.img.data.set(this.wasmMem8.slice(0, this.img.data.length))
        this.ctx.putImageData(this.img, 0, 0)

        if (!this.showAnswer) { return }

        const guessCircle = new Path2D()
        const guessCanvasCoord = this.complexToCanvas(guess)
        guessCircle.arc(guessCanvasCoord[0], guessCanvasCoord[1], 5, 0, 2 * Math.PI)

        const clueCircle = new Path2D()
        const clueCanvasCoord = this.complexToCanvas(clue.z)
        clueCircle.arc(clueCanvasCoord[0], clueCanvasCoord[1], 5, 0, 2 * Math.PI)

        this.ctx.fillStyle = "red"
        this.ctx.fill(guessCircle)
        this.ctx.fill(clueCircle)

        this.ctx.strokeStyle = "red"
        this.ctx.beginPath()
        this.ctx.moveTo(clueCanvasCoord[0], clueCanvasCoord[1])
        this.ctx.lineTo(guessCanvasCoord[0], guessCanvasCoord[1])
        this.ctx.stroke()
    }

    canvasToComplex(point) {
        const real = this.center[0] + (point[0] - CANVAS_SIZE / 2) / this.ppu
        const imag = this.center[1] - (point[1] - CANVAS_SIZE / 2) / this.ppu
        return [real, imag]
    }

    complexToCanvas(z) {
        const x = CANVAS_SIZE / 2 + this.ppu * (z[0] - this.center[0])
        const y = CANVAS_SIZE / 2 - this.ppu * (z[1] - this.center[1])
        return [x, y]
    }
}

const clueView = new MandelView($id("clueCanvas"), clue.z, clue.diam, true)
const guessView = new MandelView($id("guessCanvas"))
guessCanvas.focus({ focusVisible: false })

clueView.initialize()
guessView.initialize()

// ------------------------------------------------------------------------------------- //
// Event Listeners
// ------------------------------------------------------------------------------------- //

const offsetToClampedPos = (offset, dim, offsetDim) => {
    let pos = offset - ((offsetDim - dim) / 2)
    return pos < 0 ? 0 : pos > dim ? dim : pos
}

const eventClampedPos = (event) => {
    const x = offsetToClampedPos(event.offsetX, event.target.width, event.target.offsetWidth)
    const y = offsetToClampedPos(event.offsetY, event.target.height, event.target.offsetHeight)
    return [x, y]
}

const mouse_track = (mandelView) => (event) => {
    pointer = mandelView.canvasToComplex(eventClampedPos(event))

    $id('x_complex_coord').innerHTML = Number.parseFloat(pointer[0]).toFixed(16)
    $id('y_complex_coord').innerHTML = Number.parseFloat(pointer[1]).toFixed(16)
}

const zoom = (zoomIn, mandelView) => event => {
    if (!zoomIn) event.preventDefault()

    pointer = mandelView.canvasToComplex(eventClampedPos(event))
    mandelView.center = zoomIn
        ? midpoint(mandelView.center, pointer)
        : subVector(multVector(2, mandelView.center), pointer)

    mandelView.ppu = zoomIn
        ? (new_ppu => new_ppu > MAX_PPU ? MAX_PPU : new_ppu)(mandelView.ppu * 2)
        : (new_ppu => new_ppu < MIN_PPU ? MIN_PPU : new_ppu)(mandelView.ppu / 2)

    if (mandelView.ppu === MIN_PPU) { mandelView.center = [...mandelView.init_center] }

    mandelView.update()
}

const addPoints = (distance) => {
    const maxThreshold = 2.0 - Math.log2(clue.diam)
    const r = Math.max(2.0 - Math.log2(distance), 0.0)
    const extraPoints = Math.min(Math.round(900 * r / maxThreshold + 100), 1000)
    points += extraPoints
    return extraPoints
}

const pickGuess = (mandelView) => (event) => {
    if (event.key == " " && mouseOn && !madeGuess) {
        guess = [...pointer]
        madeGuess = true

        $id('solution_x').innerHTML = Number.parseFloat(clue.z[0]).toFixed(16)
        $id('solution_y').innerHTML = Number.parseFloat(clue.z[1]).toFixed(16)

        const d = distance(clue.z, guess)
        pointsSpan.innerHTML = Number.parseInt(points)
        pointsAddedSpan.innerHTML = " + " + Number.parseInt(addPoints(d))

        mandelView.ppu = CANVAS_SIZE / (2 * d)
        mandelView.center = midpoint(clue.z, guess)
        mandelView.showAnswer = true

        mandelView.update()
    }
}

guessView.canvas.addEventListener("mousemove", mouse_track(guessView), false)
guessView.canvas.addEventListener('click', zoom(true, guessView), false)
guessView.canvas.addEventListener('contextmenu', zoom(false, guessView), false)
guessView.canvas.addEventListener("mouseover", (event) => { mouseOn = true })
guessView.canvas.addEventListener("mouseleave", (event) => { mouseOn = false })
guessView.canvas.addEventListener("keydown", pickGuess(guessView))


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