import { chromium } from '@playwright/test';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const directory = process.env.HDR_COMPARE_DIR ?? '/Volumes/WORK/exr/unified-plugin-check';
const assets = process.env.BENCH_ASSETS ?? 'http://127.0.0.1:4180/';
const geometry = process.env.BENCH_GEOMETRY ?? 'Original 5.9M-triangle geometry with Draco';
const hdrFilename = process.env.BENCH_HDR_FILENAME ?? 'Person003-lit-hdr.glb';
const base = process.env.BENCH_URL ?? 'http://127.0.0.1:4178/';
const duration = Number(process.env.BENCH_DURATION ?? 10000);
const runs = Number(process.env.BENCH_RUNS ?? 3);
const models = Object.fromEntries(await Promise.all(['hdr','sdr'].map(async name => [name, await stat(join(directory,
    name === 'hdr' ? hdrFilename : 'Person003-lit-sdr.glb'))])));
const report = { date: new Date().toISOString(), duration, runs, environments: [], validation: [], results: [], notes: [
    `${geometry}; identical 4K source dimensions; Lit material retained.`,
    'SDR uses UASTC LDR KTX2 of the HDR export PNG fallback; HDR contains UASTC HDR plus that embedded PNG fallback.',
    'Fresh browser contexts; load time includes local HTTP, GLB parsing, Draco decoding and texture upload. Not an internet download benchmark.',
    '1280x720 viewport, deviceScaleFactor 1, HD with MSAA/EASU/sharpness 1; TAA/SSAO initially off. Continuous orbit.',
    'Texture bytes are engine allocation estimates, not measured physical VRAM. JS heap is not total process memory.',
    'Physical HDR output only measured when device.isHdr and real dynamic-range media query support it.'
] };
const save = () => writeFile(join(directory,'performance-embedded.json'), JSON.stringify(report,null,2));
const quantile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))]:null;
const browser = await chromium.launch({ channel:'chrome', headless:false });
try {
 for (const backend of ['webgl','webgpu']) {
  for (let run=0;run<runs;run++) {
   for (const name of (run%2?['hdr','sdr']:['sdr','hdr'])) {
    const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE_ERROR',e.stack);});
    page.on('console',m=>{if(m.type()==='error')console.log('BROWSER_ERROR',m.text());});
    const progress=setInterval(()=>page.evaluate(()=>({meshes:window.viewer?.meshInstances?.length,spinner:window.viewer?.observer.get('ui.spinner'),error:window.viewer?.observer.get('ui.error'),hdr:window.viewer?.observer.get('runtime.hdrSource')})).then(s=>console.log('LOAD_STATE',JSON.stringify(s))).catch(()=>{}),15000);progress.unref();
    // Reproduce the previously reported stale exposure preference.
    await page.addInitScript(()=>localStorage.setItem('model-viewer-uistate',JSON.stringify({camera:{hdrExposure:-8}})));
    const filename = name === 'hdr' ? hdrFilename : 'Person003-lit-sdr.glb';
    const start=Date.now();await page.goto(`${base}?${backend}&load=${encodeURIComponent(`${assets}${filename}`)}`);
    await page.waitForFunction(hdr=>{
      const v=window.viewer;return v?.meshInstances?.length>0&&!v.observer.get('ui.spinner')&&(!hdr||v.observer.get('runtime.hdrSource'));
    },name==='hdr',{timeout:120000});
    await page.evaluate(()=>new Promise(resolve=>{const v=window.viewer;v.app.once('postrender',resolve);v.renderNextFrame();}));
    clearInterval(progress);
    const loadMs=Date.now()-start;
    const initial=await page.evaluate(()=>{
      const v=window.viewer,d=v.app.graphicsDevice;
      return {exposure:v.observer.get('camera.hdrExposure'),lit:v.meshInstances.every(m=>m.material.useLighting),
        hdrSource:!!v.observer.get('runtime.hdrSource'),hdrAvailable:!!v.observer.get('runtime.hdrAvailable'),
        hdrConfigured:d.isHdr,displayHdr:matchMedia('(dynamic-range: high)').matches,backend:d.deviceType,
        backbuffer:[d.width,d.height],userAgent:navigator.userAgent,formats:JSON.parse(v.observer.get('scene.materialChannelFormats'))};
    });
    if (!initial.lit || (name==='hdr'&&initial.exposure!==0)) throw new Error(`Invalid material/exposure: ${JSON.stringify(initial)}`);
    if(run===0)report.environments.push({name,...initial});
    await page.evaluate(()=>{
      const v=window.viewer,o=v.observer;
      o.set('camera.hq',true);o.set('camera.multisample',true);o.set('camera.taa',false);o.set('camera.ssao',false);o.set('camera.easu',true);o.set('camera.sharpness',1);
      o.set('camera.hdrExposure',0);o.set('runtime.hdrRequested',false);v.app.autoRender=true;
      const focus=v.cameraControls.getFocus().clone(),position=v.cameraControls.getPosition().clone();
      const radius=position.distance(focus),height=position.y;let angle=0;
      v.app.on('update',dt=>{angle+=dt*.2;position.set(focus.x+Math.sin(angle)*radius,height,focus.z+Math.cos(angle)*radius);v.cameraControls.reset(focus,position);});
      v.app.on('frameend',()=>{const s=window.__embeddedBench;if(s){const now=performance.now();if(s.last)s.frames.push(now-s.last);s.last=now;}});
      const profiler=v.app.graphicsDevice.gpuProfiler;if(profiler){const original=profiler.report;profiler.enabled=true;
       profiler.report=function(version,timings,frameTime){original.call(this,version,timings,frameTime);const ms=frameTime??timings?.reduce((a,b)=>a+b,0);if(window.__embeddedBench&&Number.isFinite(ms)&&ms>=0)window.__embeddedBench.gpu.push(ms);};}
    });
    const modes=name==='hdr'&&initial.hdrAvailable?[false,true]:[false];
    for(const extended of modes){
      await page.evaluate(extended=>window.viewer.observer.set('runtime.hdrRequested',extended),extended);
      await page.waitForTimeout(2000);
      await page.evaluate(()=>{window.__embeddedBench={frames:[],gpu:[],last:0};});
      await page.waitForTimeout(duration);
      const sample=await page.evaluate(()=>{
        const v=window.viewer,d=v.app.graphicsDevice,s=window.__embeddedBench;window.__embeddedBench=null;
        return {...s,textureBytes:d._vram.tex,geometryBytes:d._vram.vb+d._vram.ib,hdrBytes:v.observer.get('runtime.hdrTextureBytes'),
         heapBytes:performance.memory?.usedJSHeapSize,hdrActive:!!v.observer.get('runtime.hdrActive'),target:[v.camera.camera.renderTarget.width,v.camera.camera.renderTarget.height]};
      });
      if(sample.hdrActive!==extended)throw new Error('HDR toggle state mismatch');
      const result={backend,run:run+1,mode:name==='sdr'?'SDR KTX2':extended?'HDR → HDR display':'HDR → SDR display',loadMs,fileBytes:models[name].size,
       fps:sample.frames.length*1000/sample.frames.reduce((a,b)=>a+b,0),p95Ms:quantile(sample.frames,.95),gpuMedianMs:quantile(sample.gpu,.5),gpuP95Ms:quantile(sample.gpu,.95),
       gpuSamples:sample.gpu.length,frames:sample.frames.length,textureBytes:sample.textureBytes,geometryBytes:sample.geometryBytes,hdrBytes:sample.hdrBytes,heapBytes:sample.heapBytes,target:sample.target};
      report.results.push(result);await save();console.log(JSON.stringify(result));
    }
    if(run===0&&name==='hdr'){
     for(const effect of ['camera.multisample','camera.taa','camera.ssao']){
      await page.evaluate(effect=>{const o=window.viewer.observer;for(const k of ['camera.multisample','camera.taa','camera.ssao'])o.set(k,k===effect);},effect);
      await page.waitForTimeout(500);
      const state=await page.evaluate(()=>({post:!!window.viewer.postProcessingFrame,format:window.viewer.camera.camera.renderTarget.colorBuffer.format}));
      if(!state.post)throw new Error(`Postprocessing missing: ${effect}`);report.validation.push({backend,effect,...state});
     }
     await page.evaluate(()=>{const o=window.viewer.observer;o.set('camera.ssao',false);o.set('camera.multisample',true);o.set('runtime.hdrRequested',false);});
     await page.waitForTimeout(500);
     const png=await page.evaluate(async()=>Array.from(await window.viewer.captureViewportImage()));
     await writeFile(join(directory,`${backend}-lit-hdr.png`),Buffer.from(png));
    }
    if(errors.length)throw new Error(errors.join('\n'));
    await context.close();await save();
   }
  }
 }
} finally {await browser.close();await save();}
process.exit(0);
