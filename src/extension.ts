import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(PdfAnnotatorEditorProvider.register(context));
}

class PdfAnnotatorEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            'pdfAnnotator.editor',
            new PdfAnnotatorEditorProvider(context),
            { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
        );
    }
    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
        panel.webview.options = { enableScripts: true };
        const data = await vscode.workspace.fs.readFile(document.uri);
        panel.webview.html = getHtml(Buffer.from(data).toString('base64'), document.uri);
        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'save' || msg.type === 'saveAs') {
                await this.savePdf(document.uri, msg.annotations, msg.type === 'save');
            }
        });
    }

    private async savePdf(uri: vscode.Uri, annotations: any[], overwrite: boolean) {
        try {
            const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
            const pdfDoc = await PDFDocument.load(await vscode.workspace.fs.readFile(uri));
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const pages = pdfDoc.getPages();
            const s = 1.5;

            for (const a of annotations) {
                const pi = (a.page || 1) - 1;
                if (pi < 0 || pi >= pages.length) continue;
                const page = pages[pi];
                const ph = page.getSize().height;
                const tx = (x: number) => x / s;
                const ty = (y: number) => ph - y / s;
                const hex = (a.color || '#000000').replace('#', '');
                const c = rgb(parseInt(hex.substring(0,2),16)/255, parseInt(hex.substring(2,4),16)/255, parseInt(hex.substring(4,6),16)/255);

                if (a.type === 'text') {
                    const fontSize = (a.fontSize || 16) / s;
                    page.drawText(a.text || '', { x: tx(a.x), y: ty(a.y), size: fontSize, font, color: c });
                } else if (a.path && a.path.length > 1) {
                    const lw = (a.lineWidth || 3) / s;
                    const op = a.type === 'highlight' ? 0.3 : 1.0;
                    for (let i = 0; i < a.path.length - 1; i++) {
                        page.drawLine({
                            start: { x: tx(a.path[i].x), y: ty(a.path[i].y) },
                            end: { x: tx(a.path[i+1].x), y: ty(a.path[i+1].y) },
                            thickness: lw, color: c, opacity: op,
                        });
                    }
                }
            }

            const bytes = await pdfDoc.save();
            if (overwrite) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(bytes));
                vscode.window.showInformationMessage('PDF saved.');
            } else {
                const dir = path.dirname(uri.fsPath);
                const base = path.basename(uri.fsPath, path.extname(uri.fsPath));
                const out = vscode.Uri.file(path.join(dir, `${base}_annotated.pdf`));
                await vscode.workspace.fs.writeFile(out, Buffer.from(bytes));
                vscode.window.showInformationMessage(`Saved as ${base}_annotated.pdf`);
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Save failed: ${e}`);
        }
    }
}

function getHtml(pdfBase64: string, uri: vscode.Uri): string {
    const fname = path.basename(uri.fsPath);
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
:root{--bg:#1e1e1e;--tb:#252526;--border:#3c3c3c;--btn:#333;--btn-h:#444;--active:#0078d4;--t:#ccc;--tw:#fff}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--t);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;font-size:13px}
.toolbar{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;gap:4px;padding:6px 10px;background:var(--tb);border-bottom:1px solid var(--border);height:42px}
.toolbar .sep{width:1px;height:24px;background:var(--border);margin:0 6px}
.toolbar button{display:flex;align-items:center;gap:4px;background:var(--btn);color:var(--t);border:1px solid transparent;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;height:28px;white-space:nowrap}
.toolbar button:hover{background:var(--btn-h)}
.toolbar button.active{background:var(--active);color:var(--tw);border-color:#0078d4}
.toolbar button.save-btn{background:#0e7a0d;color:#fff}
.toolbar button.save-btn:hover{background:#0a9e0a}
.toolbar button.saveas-btn{background:#555}
.toolbar button.saveas-btn:hover{background:#666}
.toolbar button.danger{color:#f48771}
.toolbar button.danger:hover{background:#5a1d1d}
.toolbar input[type="color"]{width:28px;height:28px;border:1px solid var(--border);border-radius:4px;cursor:pointer;padding:1px;background:var(--btn)}
.toolbar input[type="range"]{width:70px;accent-color:#0078d4}
.toolbar select{background:var(--btn);color:var(--t);border:1px solid var(--border);padding:4px;border-radius:4px;height:28px;font-size:12px}
.toolbar label{font-size:11px;color:#999}
.toolbar .fname{margin-left:auto;font-size:11px;color:#666}
#container{position:absolute;top:42px;left:0;right:0;bottom:0;overflow-y:auto;overflow-x:auto;display:flex;flex-direction:column;align-items:center;padding:10px;gap:8px;background:#1a1a1a}
.page-wrap{position:relative;display:inline-block;box-shadow:0 2px 12px rgba(0,0,0,0.5);flex-shrink:0}
.page-wrap canvas.pdf{display:block}
.page-wrap canvas.draw{position:absolute;top:0;left:0}
.page-label{text-align:center;font-size:11px;color:#666;padding:2px 0}
.text-input{position:absolute;z-index:200;background:transparent;border:1px dashed #0078d4;padding:2px;outline:none;overflow:hidden;resize:none;white-space:pre;min-width:20px;min-height:1em}
.text-input:focus{border-color:#0078d4}
.sel-box{position:absolute;border:2px dashed #0078d4;pointer-events:none;z-index:150}
.toast{position:fixed;bottom:20px;right:20px;background:#0e7a0d;color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;opacity:0;transition:opacity 0.3s;pointer-events:none;z-index:999}
.toast.show{opacity:1}
</style></head>
<body>
<div class="toolbar">
    <button id="t-select" data-tool="select">&#9754; Select</button>
    <button id="t-draw" data-tool="draw" class="active">&#9998; Draw</button>
    <button id="t-highlight" data-tool="highlight">&#9618; Highlight</button>
    <button id="t-text" data-tool="text">T Text</button>
    <button id="t-erase" data-tool="erase">&#10005; Erase</button>
    <div class="sep"></div>
    <input type="color" id="color" value="#000000" title="Color">
    <label>Pen</label>
    <input type="range" id="penSize" min="1" max="30" value="3">
    <span id="penVal">3</span>
    <div class="sep"></div>
    <label>Font</label>
    <select id="fontSize">
        <option value="10">10</option><option value="12">12</option><option value="14">14</option>
        <option value="16" selected>16</option><option value="18">18</option><option value="20">20</option>
        <option value="24">24</option><option value="30">30</option><option value="36">36</option><option value="48">48</option>
    </select>
    <input type="text" id="fontFamily" value="Arial" list="fontList" style="background:var(--btn);color:var(--t);border:1px solid var(--border);padding:4px;border-radius:4px;height:28px;font-size:12px;width:100px">
    <datalist id="fontList">
        <option value="Arial"><option value="Helvetica"><option value="Times New Roman"><option value="Georgia">
        <option value="Courier New"><option value="Verdana"><option value="Trebuchet MS"><option value="Impact">
        <option value="Comic Sans MS"><option value="Palatino"><option value="Garamond"><option value="Bookman">
        <option value="Tahoma"><option value="Lucida Console"><option value="Monaco"><option value="Menlo">
        <option value="Consolas"><option value="SF Pro"><option value="Futura"><option value="Avenir">
    </datalist>
    <div class="sep"></div>
    <button id="undo">&#8630; Undo</button>
    <button id="clearPage" class="danger">Clear</button>
    <div class="sep"></div>
    <button id="save" class="save-btn">Save</button>
    <button id="saveAs" class="saveas-btn">Save Copy</button>
    <span class="fname">${fname}</span>
</div>
<div id="container"></div>
<div class="toast" id="toast"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"><\/script>
<script>
const vscode=acquireVsCodeApi();
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const container=document.getElementById('container');
const SCALE=1.5;
let pdfDoc=null,tool='draw';
let color='#000000',penSize=3,fontSize=16,fontFamily='Arial';
let annotations={},undoStacks={},pageCanvases={};
let activeTextInput=null,selectedAnnotation=null,dragOffset=null;

// Toolbar
document.querySelectorAll('[data-tool]').forEach(b=>{
    b.addEventListener('click',()=>{
        commitText(); clearSelection();
        tool=b.dataset.tool;
        document.querySelectorAll('[data-tool]').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        Object.values(pageCanvases).forEach(pc=>{
            pc.draw.style.cursor={select:'default',text:'text',erase:'pointer',draw:'crosshair',highlight:'crosshair'}[tool]||'crosshair';
        });
    });
});
document.getElementById('color').addEventListener('input',e=>color=e.target.value);
document.getElementById('penSize').addEventListener('input',e=>{penSize=+e.target.value;document.getElementById('penVal').textContent=penSize});
document.getElementById('fontSize').addEventListener('change',e=>fontSize=+e.target.value);
document.getElementById('fontFamily').addEventListener('change',e=>fontFamily=e.target.value);
document.getElementById('undo').addEventListener('click',undoCurrent);
document.getElementById('clearPage').addEventListener('click',clearCurrent);
document.getElementById('save').addEventListener('click',()=>doSave('save'));
document.getElementById('saveAs').addEventListener('click',()=>doSave('saveAs'));
document.addEventListener('keydown',e=>{
    if(activeTextInput&&e.key!=='Escape'&&!(e.metaKey||e.ctrlKey))return;
    if((e.metaKey||e.ctrlKey)&&e.key==='z'){e.preventDefault();undoCurrent()}
    if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();doSave('save')}
    if(e.key==='Escape'){commitText();clearSelection()}
    if(e.key==='Delete'||e.key==='Backspace'){if(selectedAnnotation&&!activeTextInput){e.preventDefault();deleteSelected()}}
});

function getAnns(pg){if(!annotations[pg])annotations[pg]=[];return annotations[pg]}
function saveUndo(pg){if(!undoStacks[pg])undoStacks[pg]=[];undoStacks[pg].push(JSON.parse(JSON.stringify(getAnns(pg))));if(undoStacks[pg].length>50)undoStacks[pg].shift()}
function visPg(){
    const mid=container.scrollTop+container.clientHeight/2;
    let best=1,bd=Infinity;
    for(const pg in pageCanvases){const el=pageCanvases[pg].wrap;const c=el.offsetTop-container.offsetTop+el.offsetHeight/2;const d=Math.abs(c-mid);if(d<bd){bd=d;best=+pg}}
    return best;
}
function undoCurrent(){const pg=visPg();if(!undoStacks[pg]||!undoStacks[pg].length)return;annotations[pg]=undoStacks[pg].pop();redraw(pg)}
function clearCurrent(){const pg=visPg();saveUndo(pg);annotations[pg]=[];redraw(pg)}

// Text
let editingIdx=null; // index of annotation being edited (null = new text)
function commitText(){
    if(!activeTextInput)return;
    const{el,pg,x,y}=activeTextInput;
    const text=el.value.trim();
    if(editingIdx!==null){
        // Editing existing annotation
        if(text){
            saveUndo(pg);
            const a=getAnns(pg)[editingIdx];
            a.text=text;a.color=color;a.fontSize=fontSize;a.fontFamily=fontFamily;
        }else{
            saveUndo(pg);getAnns(pg).splice(editingIdx,1);
        }
        editingIdx=null;
    }else{
        if(text){saveUndo(pg);getAnns(pg).push({type:'text',text,x,y:y+fontSize,color,fontSize,fontFamily,page:pg})}
    }
    redraw(pg);el.remove();activeTextInput=null;
}
function spawnText(pg,cx,cy,existingText,existingIdx){
    commitText();clearSelection();
    const wrap=pageCanvases[pg].wrap,dc=pageCanvases[pg].draw;
    const r=dc.getBoundingClientRect();
    const sx=r.width/dc.width,sy=r.height/dc.height;
    const input=document.createElement('textarea');
    input.className='text-input';
    input.style.left=(cx*sx)+'px';input.style.top=(cy*sy)+'px';
    input.style.fontSize=fontSize+'px';input.style.fontFamily=fontFamily;input.style.color=color;
    input.style.lineHeight='1.2';
    if(existingText){input.value=existingText;editingIdx=existingIdx}else{editingIdx=null}
    input.addEventListener('input',()=>{input.style.height='auto';input.style.height=input.scrollHeight+'px';input.style.width=Math.max(100,input.scrollWidth+10)+'px'});
    input.addEventListener('keydown',e=>{
        if(e.key==='Escape'){e.preventDefault();input.value=existingText||'';commitText()}
    });
    wrap.appendChild(input);
    requestAnimationFrame(()=>{input.focus();if(existingText){input.style.height='auto';input.style.height=input.scrollHeight+'px';input.style.width=Math.max(100,input.scrollWidth+10)+'px'}});
    activeTextInput={el:input,pg,x:cx,y:cy};
}
function editTextAnnotation(pg,idx){
    const a=getAnns(pg)[idx];if(!a||a.type!=='text')return;
    // Set toolbar to match the annotation's style
    color=a.color||'#000';fontSize=a.fontSize||16;fontFamily=a.fontFamily||'Arial';
    document.getElementById('color').value=color;
    document.getElementById('fontSize').value=fontSize;
    document.getElementById('fontFamily').value=fontFamily;
    // Position the textarea at the annotation's canvas position, offset back by fontSize for baseline
    spawnText(pg,a.x,a.y-a.fontSize,a.text,idx);
}

// Selection
let selBox=null;
function clearSelection(){
    selectedAnnotation=null;dragOffset=null;
    if(selBox){selBox.remove();selBox=null}
    Object.keys(pageCanvases).forEach(pg=>redraw(+pg));
}
function deleteSelected(){
    if(!selectedAnnotation)return;
    const{pg,idx}=selectedAnnotation;
    saveUndo(pg);getAnns(pg).splice(idx,1);
    clearSelection();redraw(pg);
}
function showSelBox(pg,a){
    if(selBox)selBox.remove();
    const dc=pageCanvases[pg].draw,r=dc.getBoundingClientRect();
    const sx=r.width/dc.width,sy=r.height/dc.height;
    selBox=document.createElement('div');selBox.className='sel-box';
    if(a.type==='text'){
        const fs=a.fontSize||16;const ff=a.fontFamily||'Arial';
        const m=document.createElement('canvas').getContext('2d');
        m.font=fs+'px '+ff;
        const w=m.measureText(a.text).width;
        selBox.style.left=(a.x*sx-4)+'px';selBox.style.top=((a.y-fs)*sy-4)+'px';
        selBox.style.width=(w*sx+8)+'px';selBox.style.height=(fs*sy*1.3+8)+'px';
    }else if(a.path){
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        a.path.forEach(p=>{minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y)});
        selBox.style.left=(minX*sx-4)+'px';selBox.style.top=(minY*sy-4)+'px';
        selBox.style.width=((maxX-minX)*sx+8)+'px';selBox.style.height=((maxY-minY)*sy+8)+'px';
    }
    pageCanvases[pg].wrap.appendChild(selBox);
}
function hitTest(pg,pos){
    const anns=getAnns(pg);
    for(let i=anns.length-1;i>=0;i--){
        const a=anns[i];
        if(a.type==='text'){
            const fs=a.fontSize||16;const ff=a.fontFamily||'Arial';
            const m=document.createElement('canvas').getContext('2d');m.font=fs+'px '+ff;
            const w=m.measureText(a.text).width;
            if(pos.x>=a.x&&pos.x<=a.x+w&&pos.y>=a.y-fs&&pos.y<=a.y+fs*0.3)return{idx:i,ann:a};
        }else if(a.path){
            for(const p of a.path){if(Math.hypot(p.x-pos.x,p.y-pos.y)<15)return{idx:i,ann:a}}
        }
    }
    return null;
}

// Draw
let ds={active:false,pg:0,path:[]};
function getPos(e,pg){const c=pageCanvases[pg].draw,r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*(c.width/r.width),y:(e.clientY-r.top)*(c.height/r.height)}}

function setupPage(pg){
    const dc=pageCanvases[pg].draw,ctx=dc.getContext('2d');
    dc.addEventListener('dblclick',e=>{
        const pos=getPos(e,pg);
        const hit=hitTest(pg,pos);
        if(hit&&hit.ann.type==='text'){e.preventDefault();editTextAnnotation(pg,hit.idx)}
    });
    dc.addEventListener('mousedown',e=>{
        const pos=getPos(e,pg);
        if(tool==='text'){spawnText(pg,pos.x,pos.y);return}
        if(tool==='select'){
            const hit=hitTest(pg,pos);
            if(hit){
                clearSelection();
                selectedAnnotation={pg,idx:hit.idx};
                dragOffset={x:pos.x,y:pos.y};
                showSelBox(pg,hit.ann);
            }else{clearSelection()}
            return;
        }
        if(tool==='erase'){ds={active:true,pg,path:[]};eraseAt(pg,pos);return}
        ds={active:true,pg,path:[pos]};
    });
    dc.addEventListener('mousemove',e=>{
        const pos=getPos(e,pg);
        if(tool==='select'&&selectedAnnotation&&dragOffset&&e.buttons===1){
            const a=getAnns(selectedAnnotation.pg)[selectedAnnotation.idx];if(!a)return;
            const dx=pos.x-dragOffset.x,dy=pos.y-dragOffset.y;
            saveUndo(pg);
            if(a.type==='text'){a.x+=dx;a.y+=dy}
            else if(a.path){a.path.forEach(p=>{p.x+=dx;p.y+=dy})}
            dragOffset={x:pos.x,y:pos.y};
            redraw(pg);showSelBox(pg,a);
            return;
        }
        if(!ds.active||ds.pg!==pg)return;
        if(tool==='erase'){eraseAt(pg,pos);return}
        ds.path.push(pos);
        const p=ds.path;
        ctx.strokeStyle=color;ctx.lineWidth=penSize;ctx.lineCap='round';ctx.lineJoin='round';
        ctx.globalAlpha=tool==='highlight'?0.3:1.0;
        ctx.beginPath();ctx.moveTo(p[p.length-2].x,p[p.length-2].y);ctx.lineTo(pos.x,pos.y);ctx.stroke();
        ctx.globalAlpha=1.0;
    });
    const stop=()=>{
        if(!ds.active||ds.pg!==pg)return;ds.active=false;
        if(ds.path.length>1){saveUndo(pg);getAnns(pg).push({type:tool,path:[...ds.path],color,lineWidth:penSize,page:pg})}
        ds.path=[];
    };
    dc.addEventListener('mouseup',stop);dc.addEventListener('mouseleave',stop);
}

function eraseAt(pg,pos){
    const r=20,before=getAnns(pg).length;
    annotations[pg]=getAnns(pg).filter(a=>{
        if(a.type==='text'){
            const fs=a.fontSize||16,ff=a.fontFamily||'Arial';
            const m=document.createElement('canvas').getContext('2d');m.font=fs+'px '+ff;
            const w=m.measureText(a.text).width;
            return!(pos.x>=a.x-r&&pos.x<=a.x+w+r&&pos.y>=a.y-fs-r&&pos.y<=a.y+r);
        }
        if(a.path)return!a.path.some(p=>Math.hypot(p.x-pos.x,p.y-pos.y)<r);
        return true;
    });
    if(getAnns(pg).length!==before){saveUndo(pg);redraw(pg)}
}

function redraw(pg){
    const c=pageCanvases[pg].draw,ctx=c.getContext('2d');
    ctx.clearRect(0,0,c.width,c.height);
    for(const a of getAnns(pg)){
        if(a.type==='text'){
            const fs=a.fontSize||16,ff=a.fontFamily||'Arial';
            ctx.font=fs+'px '+ff;ctx.fillStyle=a.color||'#000';ctx.globalAlpha=1.0;
            // Handle multiline
            const lines=a.text.split('\\n');
            lines.forEach((line,i)=>ctx.fillText(line,a.x,a.y+i*fs*1.2));
        }else if(a.path&&a.path.length>1){
            ctx.strokeStyle=a.color||'#000';ctx.lineWidth=a.lineWidth||3;
            ctx.lineCap='round';ctx.lineJoin='round';
            ctx.globalAlpha=a.type==='highlight'?0.3:1.0;
            ctx.beginPath();ctx.moveTo(a.path[0].x,a.path[0].y);
            for(let i=1;i<a.path.length;i++)ctx.lineTo(a.path[i].x,a.path[i].y);
            ctx.stroke();ctx.globalAlpha=1.0;
        }
    }
}

function doSave(type){
    commitText();clearSelection();
    const all=[];for(const pg in annotations)for(const a of annotations[pg])all.push(a);
    vscode.postMessage({type,annotations:all});
    toast(type==='save'?'Saved!':'Saved as copy!');
}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2000)}

pdfjsLib.getDocument('data:application/pdf;base64,${pdfBase64}').promise.then(async pdf=>{
    pdfDoc=pdf;
    for(let i=1;i<=pdf.numPages;i++){
        const page=await pdf.getPage(i);const vp=page.getViewport({scale:SCALE});
        const wrap=document.createElement('div');wrap.className='page-wrap';wrap.style.width=vp.width+'px';wrap.style.height=vp.height+'px';
        const pc=document.createElement('canvas');pc.className='pdf';pc.width=vp.width;pc.height=vp.height;
        const dc=document.createElement('canvas');dc.className='draw';dc.width=vp.width;dc.height=vp.height;dc.style.cursor='crosshair';
        wrap.appendChild(pc);wrap.appendChild(dc);
        const lbl=document.createElement('div');lbl.className='page-label';lbl.textContent='Page '+i+' / '+pdf.numPages;
        container.appendChild(wrap);container.appendChild(lbl);
        pageCanvases[i]={pdf:pc,draw:dc,wrap};
        await page.render({canvasContext:pc.getContext('2d'),viewport:vp}).promise;
        setupPage(i);
    }
});
<\/script></body></html>`;
}

export function deactivate() {}
