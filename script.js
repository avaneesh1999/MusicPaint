let isDebug = /debug/.test(window.location.href)
let w3 = "http://www.w3.org/"
let svgNS = w3 + "2000/svg"
let xlinkNS = w3 + "1999/xlink"
let notes = "C C# D D# E F F# G G# A A# B".split(" ")
let w, h
let scrollX = 0, scrollY = 0, cursorX = 0
let borders = { l: 0, r: 250 }
let borderExtend = 250
let moveMode = null
let playing = false
let d = document
let $ = document.querySelector.bind(d)
let $$ = (sel, con) => Array.prototype.slice.call((con||d).querySelectorAll(sel))
let { sqrt, min, max } = Math
let distance = (a, b) => sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2)
let freq = (y) => max(880 - y, 10)
let freqToY = (f) => 880 - f
let svg = $`#main`
let masterVolume
let AC = new AudioContext()
let defaultVolume = 0.5
let initAudioContext = () => {
  if(AC.state === "suspended") {
    $`.overlay`.style.display='block'
    $`.overlay`.addEventListener('click', () => {
      $`.overlay`.style.display='none'
      AC.resume()
    })
  }
  masterVolume = AC.createGain()
  masterVolume.gain.value = defaultVolume
  masterVolume.connect(AC.destination)  
}
initAudioContext()
let music = []
let mouseNoise = null
let touchNoises = []
let midiNoises = {}
let currentType = "sine"
let clientRect = svg.getBoundingClientRect()

Array.prototype.avg = function() {
  let r = 0, i = 0;
  for(i = 0; i < this.length; i++)
    r+=this[i]
  return r/this.length
}

let typeColors = {
  "sine": "#9944ff",
  "square": "#aad400",
  "sawtooth": "#c83737",
  "triangle": "#2a7fff",
  "noise": "#ffffff"
}

let noteToFreq = (note, octave) => {
    let n = (typeof note === "string") ? notes.indexOf(note.replace(/_/,'')) : n
    let f = (110*2**octave)*2**((n+3)/12)
  return f
}

let hexColor = (c) => {
  if (c.slice(0) === '#') return c
  if (c.slice(0,4) === 'rgb(') {
    return "#" + c.slice(4,-1).split(",").map(a => ((a|0)>>4).toString(16)+((a|0)%16).toString(16)).join("")
  }
  return c
}

let types = Object.keys(typeColors)

let attribs = (el, attrs, x) => {
	for(x in attrs)
		if(attrs.hasOwnProperty(x) && attrs[x] !== undefined)
			el.setAttribute(x,attrs[x])
}

let draw = (name,attrs) => {
	let el = document.createElementNS(svgNS, name)
	if(attrs) attribs(el,attrs)
	return el
}

let scrollToCursor = () => {
    let  middleX = (clientRect.right - clientRect.left) / 2
  if (cursorX > scrollX + middleX || scrollX > cursorX) {
    scrollX = cursorX - middleX
  }
}

let relPos = (x,y) => {
  // calculate from mouse/touch position 
  // to svg coordinate
  let relativeX = scrollX + x - clientRect.left
  let relativeY = scrollY + y - clientRect.top
  return { relX: relativeX, relY: relativeY }
}

let userIsJamming = () => {
  return (!!mouseNoise) || touchNoises.length > 0 || Object.keys(midiNoises).length > 0
}

let setCursor = (x) => {
  if (userIsJamming() && x < cursorX) {
    return
  }
  cursorX = x
  scrollToCursor()
  setViewBox()
}

let SoundMachine = {
  // Helper factory that creates and reuses 
  // oscillators. Usage:
  // SoundMachine.noise(frequency, type)
  // returns a noise that starts playing
  // immediately. It does not create a
  // new oscillator each time. After a noise 
  // is muted, it can be reused, avoiding
  // memory issues.

  noises: [],
  
  whiteNoiseBuffer: null,
  createWhiteNoise: () => {
    if (! SoundMachine.whiteNoiseBuffer) {
     let len = AC.sampleRate * 2
      let buf = AC.createBuffer(1, AC.sampleRate, len)
      let data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1
      }
      SoundMachine.whiteNoiseBuffer = buf 
    }
    let bufSrc = AC.createBufferSource()
    bufSrc.buffer = SoundMachine.whiteNoiseBuffer
    bufSrc.loop = true
    bufSrc.playbackRate.value = 1.0
    return bufSrc
  },
  
  makeSomeNoise: (freq, type) => {
    let noise = {
      osc: type === "noise" ?
           SoundMachine.createWhiteNoise() : AC.createOscillator(), 
      env: AC.createGain()
    }
    let { osc, env } = noise
    if (type !== "noise") {
      osc.type = type
      osc.frequency.value = freq
      osc.detune.value = 0  
    }
    env.gain.value = 1.0
    osc.start()
    osc.connect(env)
    env.connect(masterVolume)
    SoundMachine.noises.push(noise)
    return noise
  },
  
  noise: (freq, type) => {
    // reuse a noise we muted before
    let noise = SoundMachine.noises.find(n => {
      return n.env.gain.value === 0.0 &&
        n.osc.type === type
    })
    if (! noise) {
      // create new noise
      return SoundMachine.makeSomeNoise(freq, type)
    }
    let { osc, env } = noise
    osc.frequency.setValueAtTime(freq, 0)
    // chromium issue 645776
    // osc.frequency.value = freq
    env.gain.value = 1.0
    return noise
  }
  
}

class Noise {
  constructor(x,y,type) {
    this.element=draw("path",{
      "d":"",
      "style": `stroke:${typeColors[type]};stroke-width:4;fill:none;`
    })
    this.coords = []
    this.type = type
    if (x) {
      if (typeof x === "object") {
        this.add(x)
      } else {
        if (isFinite(x) && y && isFinite(y)) this.add(x, y)  
      }
    }
    svg.appendChild(this.element)
    this.render()
  }
  
  add(x, y, quiet) {
    this.lastX = x
    this.lastY = y
    let { relX, relY } = typeof x === "object" ? x : relPos(x, y)
    if (this.coords.length > 0) {
      let lastCoord = this.coords[this.coords.length - 1]
      let firstCoord = this.coords[0]
      if (distance([relX, relY], lastCoord) < 5) {
        return
      }
      if (firstCoord[0] < relX) {
        this.coords = this.coords.filter(c => c[0] < relX)  
      } else {
        this.coords = this.coords.filter(c => c[0] > relX)
      }
    }
    this.coords.push([relX, relY])
    if (relX > borders.r) borders.r+=borderExtend
    if (relX < borders.l) borders.l-=borderExtend
    this.render()
    if (quiet) {
      return
    }
    if (! this.noise) {
      this.noise = SoundMachine.noise(freq(relY), this.type)
    }
    if (this.type !== "noise") {
      this.noise.osc.frequency.value = freq(relY)  
    } else {
      this.noise.osc.playbackRate.value = freq(relY) / 1e4
    }
    
  }
  
  playAtX(x) {
    let { coords } = this
    let l = coords.length
    if (l < 2) {
      return
    }
    let isMuted = coords[0][0] > x || coords[l - 1][0] < x
    if (isMuted) {
      if (this.playerNoise) {
        this.playerNoise.env.gain.value=0.0
        this.playerNoise = null
      }
    } else {
      let nearPoints = coords.filter((p) => Math.abs(p[0] - x) <= 5)
      let averageFreq = freq(nearPoints.map(p => p[1]).avg())
      if(!isFinite(averageFreq)) {
        return
      }
      if (!this.playerNoise) {
        this.playerNoise = SoundMachine.noise(averageFreq, this.type)
      } else {
        if (this.type !== "noise") {
          this.playerNoise.osc.frequency.setValueAtTime(averageFreq, 0)
          // https://bugs.chromium.org/p/chromium/issues/detail?id=645776
          // this.playerNoise.osc.frequency.value = averageFreq
          
        } else {
          this.playerNoise.osc.playbackRate.value = averageFreq / 1e4
        }
      }
    }
  }
  
  mute() {
    if (this.noise) {
      this.noise.env.gain.value=0.0
      this.noise = null
    }
    if (this.playerNoise) {
      this.playerNoise.env.gain.value=0.0
      this.playerNoise = null
    }
  }
  
  dispose() {
    this.mute()
    svg.removeChild(this.element)
    this.element = null
  }
  
  sortCoords() {
    this.coords.sort((a,b) => {
      if (a[0] > b[0]) return 1
      if (a[0] < b[0]) return -1
      if (a[0] == b[0]) return 0
    })
    this.render()
  }
  
  render() {
    const { coords } = this
    if (coords.length < 2) {
      return
    }
    this.element.setAttribute("d", "M"+coords[0].join(",")+
      "L"+coords.slice(1).map(c=> c.join(",")).join("L")) 
  }
  
  static fromPath(el) {
    const waveForms = Object.keys(typeColors).reduce((obj,key) => {
      obj[typeColors[key]] = key
      return obj
    },{})
    let color = hexColor(el.style.stroke)
    let d = el.getAttribute("d")
    if (waveForms[color] && /M\d+\,\d+(L\d+\,\d+)+/.test(d)) {
      let n = new Noise(null, null, waveForms[color] || "sine")
      let coords = d.slice(1).split("L").map(p => p.split(',').map(x => x|0))
      coords.forEach(c => n.add({relX: c[0], relY: c[1]}, null, true))
      return n
    }
  }  
}

let moveStart = (e) => {
  moveMode = {
    moving: true,
    x0: e.clientX,
    y0: e.clientY,
    scrollX0: scrollX,
    scrollY0: scrollY
  }
}

let moveDrag = (e) => {
  if (!moveMode.moving) {
    return
  }
  const { x0, y0, scrollX0, scrollY0 } = moveMode
  const dx = x0 - e.clientX
  const dy = y0 - e.clientY 
  scrollX = scrollX0 + dx
  scrollY = scrollY0 + dy
  setViewBox()
}

let moveEnd = (e) => {
  moveMode = { moving: false }
}

let setMoveMode = (move, e) => {
  let btn = $('#moveBtn')
  if (move) {
    moveMode = e? {
      moving: true,
      x0: e.clientX,
      y0: e.clientY,
      scrollX0: scrollX,
      scrollY0: scrollY
    } : { moving: false }
    btn.classList.add("selected")
    svg.classList.add("move")
  } else {
    moveMode = null
    btn.classList.remove("selected")
    svg.classList.remove("move")
  }
}

$('#moveBtn').addEventListener("click", e => {
  setMoveMode(!!!moveMode)
  // "multiple exclamation marks", he went on,
  //  shaking his head, "are a sure sign of
  //  a diseased mind." 
  // (Terry Pratchet in 'Eric') ♥
})


svg.addEventListener("mousedown", e => {
  if (touchNoises.length > 0) {
    // long tap on mobile
    // triggers contextmenu. 
    // Additionally: mousedown
    // without a mouseup event.
    // this would result in a never-ending
    // beeeeeeeep on mobile
    return;
  }
  if (e.button === 1) {
    const { relX, relY } = relPos(e.clientX, e.clientY)
    setCursor(relX)
    e.preventDefault()
    return
  }
  if (!isDebug && e.button === 2) {
    setMoveMode(true, e)
    return
  }
  if (mouseNoise) {
    mouseNoise.dispose()
    mouseNoise = null
  }
  if (moveMode) {
    moveStart(e)
    return
  }
  mouseNoise = new Noise(e.clientX, e.clientY, currentType)
})

svg.addEventListener("mousemove", e => {
  if (moveMode) {
    moveDrag(e)
    return
  }
  if (mouseNoise) {
    mouseNoise.add(e.clientX, e.clientY)
  }
})

svg.addEventListener("mouseup", e => {
  if (moveMode) {
    moveEnd(e)
    if (e.button === 2) {
      setMoveMode(false)
    }
    return
  }
  if (mouseNoise) {
    mouseNoise.mute()
    mouseNoise.sortCoords()
    music.push(mouseNoise)
    mouseNoise = null
  }
})

svg.addEventListener("touchstart", e => {
  if (moveMode) {
    setMoveMode(true, e.changedTouches[0])
    return
  }
  Array.prototype.slice.call(e.changedTouches).map(t => {
    touchNoises.push({
      id: t.identifier,
      noise: new Noise(t.clientX, t.clientY, currentType)
    })
  })  
})

let touch = (id) => touchNoises.find(el => el.id === id)

svg.addEventListener("touchmove", e => {
  e.preventDefault()
  if (moveMode) {
    moveDrag(e.changedTouches[0])
    return
  }
  Array.prototype.slice.call(e.changedTouches).map(t => {
    let touchObj = touch(t.identifier)
    if (touchObj) {
      touchObj.noise.add(t.clientX, t.clientY)
    }
  })
})

svg.addEventListener("touchend", e => {
  if (moveMode) {
    moveEnd(e)
    return
  }
  Array.prototype.slice.call(e.changedTouches).map((t, idx) => {
    let touchObj = touch(t.identifier)
    if (touchObj) {
      // touchObj.identifier = void 0
      touchObj.noise.mute()
      touchObj.noise.sortCoords()
      music.push(touchObj.noise)
      touchObj.noise = null
    }
  })
  touchNoises = touchNoises.filter(n => n.noise !== null)
})

let setViewBox = () => {
  clientRect = svg.getBoundingClientRect()
  w = max(0, innerWidth - clientRect.left)
  h = max(0, innerHeight - clientRect.top)
  let bounds = $`#bounds`
  let x0 = scrollX - scrollX % (borderExtend/8)
  let y0 = scrollY - scrollY % (borderExtend/8)
  let nX = 2 + ((8*w / borderExtend)|0)
  let nY = 2 + ((8*h / borderExtend)|0)
  let gridLines = Array(nX).fill(0).map((e,i) => {
    return `M${x0+i*borderExtend/8},${scrollY}l0,${h}`
  }).join('') + Array(nY).fill(0).map((e,i) => {
    return `M${scrollX},${y0+i*borderExtend/8}l${w},0`
  })
  bounds.setAttribute("d", `M${borders.l},${scrollY}l0,${h}`
                          +`M${borders.r},${scrollY}l0,${h}`)
  let cursor = $`#cursor`
  cursor.setAttribute("d", `M${cursorX},${scrollY}l0,${h}`)
  svg.setAttribute("viewBox", [scrollX, scrollY, w, h])
  let grid = $`#grid`
  grid.setAttribute("d", gridLines)
}
setViewBox()
addEventListener("resize", setViewBox)

addEventListener("contextmenu", e => {
  // prevent long-tap on touch screens 
  // to trigger the context menu event.
  // Also prevent the context menu when 
  // not in debug-mode because it is
  // used for moving the svg
  if (!isDebug || touchNoises.length > 0) {
    e.preventDefault()
    return false
  }
})

let rewind = () => {
  scrollX = borders.l 
  cursorX = borders.l
  setViewBox()
}

let play = () => {
  playing = true
  scrollX = 0
  $('#playBtn').parentNode.classList.add('hidden')
  $('#pauseBtn').parentNode.classList.remove('hidden')
}

let pause = () => {
  playing = false
  music.forEach(beep => beep.mute())
  $('#pauseBtn').parentNode.classList.add('hidden')
  $('#playBtn').parentNode.classList.remove('hidden')
}

$`#rewBtn`.addEventListener("click", rewind)
$`#playBtn`.addEventListener("click", play)
$`#pauseBtn`.addEventListener("click", pause)

let waveBtns = $$('a[role=type]')
waveBtns.map(btn => btn.addEventListener("click", (e) => {
  waveBtns.map(btn => btn.parentNode.classList.add("hidden"))
  let a = e.target
  while (a.nodeName.toLowerCase() !== 'a') {
    a = a.parentNode
  }
  let idx = waveBtns.indexOf(a)
  let nextA = waveBtns[(idx+1) % waveBtns.length]
  currentType = nextA.getAttribute("href").slice(1)
  nextA.parentNode.classList.remove("hidden")
  setMoveMode(false)
}))

let shakeEvent = new Shake()
shakeEvent.start()

let clearScr = () => {
  pause()
  let tmp = music.splice(0, music.length)
  tmp.forEach(beep => beep.dispose())
  rewind()
  scrollY = 0
  borders.l = 0
  borders.r = borderExtend
  setViewBox()
}

window.addEventListener('shake', clearScr)
$('#clrBtn').addEventListener('click', clearScr)
window.addEventListener('orientationchange', () => {
  touchNoises.splice(0,music.length).forEach(beep => beep.dispose())
})

window.addEventListener('blur', () => {
  if (masterVolume) masterVolume.gain.value = 0.0
})

window.addEventListener('focus', () => {
  if (masterVolume) masterVolume.gain.value = 0.5
}) 

let getSurroundingViewBox = () => {
  let t = Infinity, l = borders.l
  let b = -Infinity, r = borders.r
  music.forEach(m => m.coords.forEach(p => {
    t = min(t, p[1])
    b = max(b, p[1])
  }))
  if (!isFinite(t)) t = 0
  if (!isFinite(b)) b = innerHeight
  return `${t} ${l} ${b-t+1} ${r-l+1}`
}

$`#dlBtn`.addEventListener('click', () => {
  let anchor = document.createElement("a")
  anchor.setAttribute("download", "awesome-music.svg")
 let viewBox = getSurroundingViewBox()
 let code = `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n`+
        `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" \n` +
        ` "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="${viewBox}">\n${music.map(m => m.element.outerHTML).join("\n")}\n</svg>`
  anchor.setAttribute("href", "data:application/octet-stream;base64,"+btoa(code))
  anchor.click()
})

$`#ulBtn`.addEventListener('click',() => {
  if (music.length > 0) {
    if (!confirm('Discard your current music ?')) return
    clearScr()
  }
  $`#inputFile`.click()
})

$`#inputFile`.addEventListener('change', (e) => {
  let file = $`#inputFile`.files[0]
  let reader = new FileReader()
  reader.onload = () => {
    let code = reader.result.replace(/\<\?xml.+\?\>|\<\!DOCTYPE.+]\>/ig, '').trim()
    if (!code.slice(4) === "<svg") {
      return
    }
    let container = document.createElement("div")
    container.innerHTML = code
    let innerSVG = $$('svg', container)[0]
    $$("path", innerSVG).forEach(p => {
      let n = Noise.fromPath(p)
      if (n) music.push(n)
    })
    $`#inputFile`.value=""
    setViewBox()
  }
  reader.readAsText(file)
})

WebMidi.enable(function(err) {
  if (err) {
    console.log("No midi. Too bad :(")
  }
  WebMidi.inputs.forEach(input => {
    input.addListener('noteon', 'all', e => {
      let noteName = e.note.name + e.note.octave
      let f = noteToFreq(e.note.name, e.note.octave)
      let y = freqToY(f)
      if (!midiNoises[noteName]) {
        midiNoises[noteName] = new Noise({relX: cursorX, relY: y}, null, currentType)
        midiNoises[noteName].add({relX: cursorX + 5, relY: y}, null)
        scrollToCursor()
      }
    })
    input.addListener('noteoff', 'all', e => {
      let noteName = e.note.name + e.note.octave
      let f = noteToFreq(e.note.name, e.note.octave)
      let y = freqToY(f)
      if (midiNoises[noteName]) {
        midiNoises[noteName].coords[1][0] = cursorX
        music.push(midiNoises[noteName])
        midiNoises[noteName].mute()
        delete midiNoises[noteName]
        scrollToCursor()
      }
    })
  })  
})

let keyboardMappings = () => {
  let lang = navigator.language.slice(0,2)
  let mappings = {
    "de": "ysxdcvgbhnjmq2w3er5t6z7u",
    "en": "zsxdcvgbhnjmq2w3er5t6y7u",
    "fr": "wsxdcvgbhnj,a2z3er5t6y7u",
  }
  return mappings[lang]||mappings.en
}

window.addEventListener("keydown", (e) => {
  let mappings = keyboardMappings()
  console.log(e.key)
  let i = mappings.indexOf(e.key)
  if (i > -1) {
    let note = notes[i % 12]
    let oct  = 1 + (i / 12)|0
    let noteName = "_" + note + oct

   let f = noteToFreq(note, oct)
    let y = freqToY(f)
    if (!midiNoises[noteName]) {
      midiNoises[noteName] = new Noise({relX: cursorX, relY: y}, null, currentType)
      midiNoises[noteName].add({relX: cursorX + 5, relY: y}, null)
      scrollToCursor()
    }
  }
})

window.addEventListener("keyup", (e) => {
 let mappings = keyboardMappings()
  let i = mappings.indexOf(e.key)
  if (i > -1) {
    let note = notes[i % 12]
    let oct  = 1 + (i / 12)|0
    let noteName = "_" + note + oct
    if (midiNoises[noteName]) {
      midiNoises[noteName].coords[1][0] = cursorX
      music.push(midiNoises[noteName])
      midiNoises[noteName].mute()
      delete midiNoises[noteName]
      scrollToCursor()
    }
  }  
})

~function loop() {
  let midiKeys = Object.keys(midiNoises)
  if (playing || midiKeys.length > 0) {
    cursorX+=2
    if (midiKeys.length > 0 && cursorX > borders.r) {
      borders.r += borderExtend
    }
    midiKeys.forEach(k => {
      let n = midiNoises[k]
      if (n.coords.length == 2) {
        n.coords[1][0] = cursorX
        n.render()
      }
    })
    scrollToCursor()
    setViewBox()
  }
  if (playing) {
    if (cursorX > borders.r && (!userIsJamming())) setCursor(borders.l)
    music.forEach(beep => beep.playAtX(cursorX))
  }
  if (touchNoises.length > 0 || mouseNoise) {
    if (!playing) scrollX+=3
    if (mouseNoise) {
      mouseNoise.add(mouseNoise.lastX, mouseNoise.lastY)
    }
    touchNoises.forEach(n => n.noise.add(n.noise.lastX,n.noise.lastY))
    setViewBox()
  }
  requestAnimationFrame(loop)
}(0)