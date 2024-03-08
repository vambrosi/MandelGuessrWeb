function $id(element) { return document.getElementById(element) }

const WASM_PAGE_SIZE = 1024 * 64
const CANVAS_WIDTH = 500
const CANVAS_HEIGHT = 500

const MAX_PPU = 1e16
const MIN_PPU = CANVAS_WIDTH / 4

const INIT_X = -0.5
const INIT_Y = 0.0

let GUESS_CENTER_X = INIT_X
let GUESS_CENTER_Y = INIT_Y

let PPU = MIN_PPU

const canvasToComplexCoord = (canvasDim, ppu, origin) => mousePos => origin + ((mousePos - (canvasDim / 2)) / ppu)
const complexToCanvasCoord = (canvasDim, ppu, origin) => coord => canvasDim / 2 + ppu * (coord - origin)

let mouse_x = canvasToComplexCoord(CANVAS_WIDTH, PPU, GUESS_CENTER_X)
let mouse_y = canvasToComplexCoord(CANVAS_HEIGHT, PPU, GUESS_CENTER_Y)
let canvas_x = complexToCanvasCoord(CANVAS_WIDTH, PPU, GUESS_CENTER_X)
let canvas_y = complexToCanvasCoord(CANVAS_HEIGHT, PPU, GUESS_CENTER_Y)

let pointer = {
    x: 0.0,
    y: 0.0,
}

let guess = {
    x: 0.0,
    y: 0.0,
}

let solution = {
    x: -1.78850332280616,
    y: 0.0214310433284352,
    diam: 7.664854858377946e-13
}

const MAX_ITERS = 500;

const offset_to_clamped_pos = (offset, dim, offsetDim) => {
    let pos = offset - ((offsetDim - dim) / 2)
    return pos < 0 ? 0 : pos > dim ? dim : pos
}

const clueCanvas = $id("clueCanvas")
clueCanvas.width = CANVAS_WIDTH
clueCanvas.height = CANVAS_WIDTH

const guessCanvas = $id("guessCanvas")
guessCanvas.width = CANVAS_WIDTH
guessCanvas.height = CANVAS_HEIGHT

guessCanvas.setAttribute("tabindex", 0)

const clueContext = clueCanvas.getContext("2d")
const clueImage = clueContext.createImageData(clueCanvas.width, clueCanvas.height)
const clueImagePages = Math.ceil(clueImage.data.length / WASM_PAGE_SIZE)

const guessContext = guessCanvas.getContext("2d")
const guessImage = guessContext.createImageData(guessCanvas.width, guessCanvas.height)
const guessImagePages = Math.ceil(guessImage.data.length / WASM_PAGE_SIZE)

const PALETTE_PAGES = 2

const wasmClueMemory = new WebAssembly.Memory({
    initial: clueImagePages + PALETTE_PAGES
})
const wasmClueMemory8 = new Uint8ClampedArray(wasmClueMemory.buffer)
const clueShared = {
    math: {
        log2: Math.log2,
    },
    js: {
        shared_mem : wasmClueMemory,
        image_offset : 0,
        palette_offset : WASM_PAGE_SIZE * clueImagePages
    }
}

const wasmGuessMemory = new WebAssembly.Memory({
    initial: guessImagePages + PALETTE_PAGES
})
const wasmGuessMemory8 = new Uint8ClampedArray(wasmGuessMemory.buffer)
const guessShared = {
    math: {
        log2: Math.log2,
    },
    js: {
        shared_mem : wasmGuessMemory,
        image_offset : 0,
        palette_offset : WASM_PAGE_SIZE * guessImagePages
    }
}

let wasmObj

const start = async () => {
    wasmObj = await WebAssembly.instantiateStreaming(
        fetch("./wat/plot.wasm"),
        guessShared
    )

    const wasmClueObj = await WebAssembly.instantiateStreaming(
        fetch("./wat/plot.wasm"),
        clueShared
    )

    wasmObj.instance.exports.gen_palette()
    wasmClueObj.instance.exports.gen_palette()

    const start_time = performance.now()
    wasmObj.instance.exports.mandel_plot(
        CANVAS_WIDTH, CANVAS_HEIGHT, INIT_X, INIT_Y, PPU, MAX_ITERS
    )

    console.log(performance.now() - start_time)

    wasmClueObj.instance.exports.mandel_plot(
        CANVAS_WIDTH, CANVAS_HEIGHT, solution.x, solution.y, 500/solution.diam, MAX_ITERS
    )

    // Transfer the relevant slice of shared memory to the image, then display it in the canvas
    guessImage.data.set(wasmGuessMemory8.slice(0, guessImage.data.length))
    guessContext.putImageData(guessImage, 0, 0)

    clueImage.data.set(wasmClueMemory8.slice(0, clueImage.data.length))
    clueContext.putImageData(clueImage, 0, 0)
}

const mouse_track = event => {
    pointer.x = mouse_x(
        offset_to_clamped_pos(event.offsetX, event.target.width, event.target.offsetWidth)
    )
    pointer.y = mouse_y(
        offset_to_clamped_pos(event.offsetY, event.target.height, event.target.offsetHeight)
    ) * -1

    $id('x_complex_coord').innerHTML = Number.parseFloat(pointer.x).toFixed(14)
    $id('y_complex_coord').innerHTML = Number.parseFloat(pointer.y).toFixed(14)
}

const zoom = zoom_in => event => {
    // Suppress default context menu when zooming out
    if (!zoom_in) event.preventDefault()

    // Transform the mouse pointer pixel location to coordinates in the complex plane
    GUESS_CENTER_X = mouse_x(offset_to_clamped_pos(event.offsetX, event.target.width, event.target.offsetWidth))
    GUESS_CENTER_Y = mouse_y(offset_to_clamped_pos(event.offsetY, event.target.height, event.target.offsetHeight))

    // Change zoom level
    PPU = zoom_in
        ? (new_ppu => new_ppu > MAX_PPU ? MAX_PPU : new_ppu)(PPU * 2)
        : (new_ppu => new_ppu < MIN_PPU ? MIN_PPU : new_ppu)(PPU / 2)

    // If we're back out to the default zoom level, then reset the Mandelbrot Set image origin
    if (PPU === MIN_PPU) {
        GUESS_CENTER_X = INIT_X
        GUESS_CENTER_Y = INIT_Y
    }

    // Update the mouse position helper functions using the new X/Y origin and zoom level
    mouse_x = canvasToComplexCoord(CANVAS_WIDTH, PPU, GUESS_CENTER_X)
    mouse_y = canvasToComplexCoord(CANVAS_HEIGHT, PPU, GUESS_CENTER_Y)
    canvas_x = complexToCanvasCoord(CANVAS_WIDTH, PPU, GUESS_CENTER_X)
    canvas_y = complexToCanvasCoord(CANVAS_HEIGHT, PPU, GUESS_CENTER_Y)

    // Redraw the Mandelbrot Set
    wasmObj.instance.exports.mandel_plot(
        CANVAS_WIDTH, CANVAS_HEIGHT, GUESS_CENTER_X, GUESS_CENTER_Y, PPU, MAX_ITERS
    )

    guessImage.data.set(wasmGuessMemory8.slice(0, guessImage.data.length))
    guessContext.putImageData(guessImage, 0, 0)
}

const pickGuess = (event) => {
    if (event.key == " ") {
        guess.x = pointer.x
        guess.y = pointer.y

        $id('guess_x').innerHTML = Number.parseFloat(guess.x).toFixed(14)
        $id('guess_y').innerHTML = Number.parseFloat(guess.y).toFixed(14)

        const distance = (x1, y1, x2, y2) => Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
        const d = distance(guess.x, guess.y, solution.x, solution.y)

        const midpoint = (x1, x2) => 0.5 * (x1 + x2)

        PPU = CANVAS_WIDTH / (2 * d)
        GUESS_CENTER_X = midpoint(solution.x, guess.x)
        GUESS_CENTER_Y = midpoint(solution.y, guess.y)

        mouse_x = canvasToComplexCoord(CANVAS_WIDTH, PPU, GUESS_CENTER_X)
        mouse_y = canvasToComplexCoord(CANVAS_HEIGHT, PPU, GUESS_CENTER_Y)
        canvas_x = complexToCanvasCoord(CANVAS_WIDTH, PPU, GUESS_CENTER_X)
        canvas_y = complexToCanvasCoord(CANVAS_HEIGHT, -PPU, GUESS_CENTER_Y)

        wasmObj.instance.exports.mandel_plot(
            CANVAS_WIDTH, CANVAS_HEIGHT, GUESS_CENTER_X, GUESS_CENTER_Y, PPU, MAX_ITERS
        )

        guessImage.data.set(wasmGuessMemory8.slice(0, guessImage.data.length))
        guessContext.putImageData(guessImage, 0, 0)

        const guessCircle = new Path2D()
        guessCircle.arc(canvas_x(guess.x), canvas_y(guess.y), 5, 0, 2 * Math.PI)

        const solutionCircle = new Path2D()
        solutionCircle.arc(canvas_x(solution.x), canvas_y(solution.y), 5, 0, 2 * Math.PI)

        guessContext.fillStyle = "red"
        guessContext.fill(guessCircle)
        guessContext.fill(solutionCircle)
    }
}

guessCanvas.addEventListener("mousemove", mouse_track, false)
guessCanvas.addEventListener('click', zoom(true), false)
guessCanvas.addEventListener('contextmenu', zoom(false), false)
guessCanvas.addEventListener("keydown", pickGuess)

start()
guessCanvas.focus()