import { EMPTY_MASK_IMAGE } from "./mask-svg";
/** Portable generated React runtime; receives only an explicitly supplied registered library. */
export const handoffRuntime = `import { Component, createElement, useEffect, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { resolveImageAsset } from "./imageResources";
const emptyMaskImage=${JSON.stringify(EMPTY_MASK_IMAGE)};
export type PaintTree = {tag:"div"|"img"|"svg"|"defs"|"pattern"|"image"|"rect"|"path"|"clipPath";props:Record<string,unknown>;children:PaintTree[]};
function PaintLayer({tree,assetBaseURL}:{tree:PaintTree;assetBaseURL?:string}):ReactNode{const props={...tree.props};for(const key of ["src","href"])if(typeof props[key]==="string")props[key]=resolveImageAsset(props[key],assetBaseURL);return createElement(tree.tag,props,...tree.children.map((child,index)=><PaintLayer key={index} tree={child} assetBaseURL={assetBaseURL}/>))}
type MaskData={svg:string;maskImage:string;bounds:{x:number;y:number;width:number;height:number};groupSize:{width:number;height:number};mode:"alpha"|"luminance";sourceId:string;diagnostics:{code:string;nodeId?:string;feature:string}[]};
export type HandoffNode = { id:string; type:string; props:Record<string,unknown>; slots:Record<string,HandoffNode[]>; hidden?:boolean;maskSource?:true;maskData?:MaskData; paintTree?:PaintTree; scene?:{kind:string;width:number;height:number;fill?:string;stroke?:string;strokeWidth?:number;path?:string;fontSize?:number;textStyle?:{direction?:"ltr"|"rtl"|"auto"}}; style:Record<string,string|number>; contentClipStyle?:Record<string,string|number>; contentStyle?:Record<string,string|number> };
export type RegisteredLibrary = { id:string; version:string; components:Record<string,{defaultProps:Record<string,unknown>;render:ComponentType<Record<string,any>>}> };
class Boundary extends Component<{children:ReactNode},{error:string}> {
  state={error:""}; static getDerivedStateFromError(error:Error){return {error:error.message}};
  render(){return this.state.error?<div role="alert">Компонент требует контекст: {this.state.error}</div>:this.props.children}
}
function Mask({node,library,expected,assetBaseURL}:{node:HandoffNode;library:RegisteredLibrary;expected:{id:string;version:string};assetBaseURL?:string}){
 const data=node.maskData;
 const [decoded,setDecoded]=useState<{svg:string;failed:boolean}|null>(null);
 const ready=!!data&&decoded?.svg===data.svg&&!decoded.failed;
 const failed=!data||!!data.diagnostics.length||decoded?.svg===data.svg&&decoded.failed;
 useEffect(()=>{if(!data||data.diagnostics.length)return;let active=true;const image=new Image();image.src="data:image/svg+xml,"+encodeURIComponent(data.svg);void image.decode().then(()=>{if(active)setDecoded({svg:data.svg,failed:false})},()=>{if(active)setDecoded({svg:data.svg,failed:true})});return()=>{active=false;image.src=""}},[data?.svg,data?.diagnostics.length]);
 const b=data?.bounds??{x:0,y:0,width:1,height:1},g=data?.groupSize??{width:node.scene?.width??1,height:node.scene?.height??1};
 const diagnostics=data?.diagnostics.length?data.diagnostics:failed?[{code:"MASK_RENDER_UNAVAILABLE",feature:"svg-decode"}]:[];
 return <><div data-studio-mask-source-holder={node.id} aria-hidden={true} inert={true} style={{position:"absolute",left:0,top:0,width:g.width,height:g.height,opacity:0,pointerEvents:"none"}}><RenderNodes nodes={(node.slots.children??[]).filter(child=>child.maskSource)} library={library} expected={expected} assetBaseURL={assetBaseURL} geometryOnly/></div><div data-studio-mask-owner={node.id} data-studio-mask-state={failed?"failed":ready?"ready":"pending"} data-studio-mask-diagnostics={JSON.stringify(diagnostics)} data-studio-mask-content={node.id} style={{position:"absolute",left:b.x,top:b.y,width:b.width,height:b.height,maskImage:ready&&!failed?data!.maskImage:emptyMaskImage,maskMode:data?.mode??"alpha",maskRepeat:"no-repeat",maskSize:"100% 100%",maskPosition:"0 0",maskOrigin:"border-box",maskClip:"border-box",overflow:"hidden"} as CSSProperties}><div style={{position:"absolute",left:-b.x,top:-b.y,width:g.width,height:g.height}}><RenderNodes nodes={(node.slots.children??[]).filter(child=>!child.maskSource)} library={library} expected={expected} assetBaseURL={assetBaseURL}/></div></div></>;
}
export function RenderNodes({nodes,library,expected,assetBaseURL,geometryOnly=false}:{nodes:HandoffNode[];library:RegisteredLibrary;expected:{id:string;version:string};assetBaseURL?:string;geometryOnly?:boolean}){
  return <>{nodes.filter(node=>!node.hidden).map(node=>{
    const definition = library.id===expected.id&&library.version===expected.version?library.components[node.type]:undefined;
    const children = Object.entries(node.slots).map(([slot,rows])=><div key={slot} data-slot={slot}><RenderNodes nodes={rows} library={library} expected={expected} assetBaseURL={assetBaseURL} geometryOnly={geometryOnly}/></div>);
    let content:ReactNode;
    if(geometryOnly)content=children;
    else if(node.scene?.kind==="mask")content=<Mask node={node} library={library} expected={expected} assetBaseURL={assetBaseURL}/>;
    else if(node.scene?.kind==="text") content=<div dir={node.scene.textStyle?.direction} style={(node.contentStyle??{fontSize:node.scene.fontSize??16,whiteSpace:"pre-wrap",overflowWrap:"anywhere",lineHeight:1.4}) as CSSProperties}>{String(node.props.text??"")}</div>;
    else if(node.scene?.kind==="vector") content=<svg width="100%" height="100%" viewBox={"0 0 "+node.scene.width+" "+node.scene.height}><path d={node.scene.path??""} fill={node.scene.fill??"none"} stroke={node.scene.stroke} strokeWidth={node.scene.strokeWidth??1}/></svg>;
    else if(node.type==="StudioImage"||node.scene?.kind==="image") content=<img src={resolveImageAsset(String(node.props.src??""),assetBaseURL)} alt={String(node.props.alt??"")} style={{width:"100%",height:"100%",objectFit:node.props.objectFit==="cover"?"cover":"contain",objectPosition:String(node.props.objectPosition??"50% 50%")}}/>;
    else if((node.scene?.kind==="frame"||node.type==="SceneFrame")) content=Object.entries(node.slots).map(([slot,rows])=><RenderNodes key={slot} nodes={rows} library={library} expected={expected} assetBaseURL={assetBaseURL}/>);
    else if(definition){const Renderer=definition.render;content=<Boundary><Renderer {...definition.defaultProps} {...node.props} {...(children.length?{children}:{})}/></Boundary>}
    else content=<div role="status">Недоступен {node.type} · исходные данные сохранены</div>;
    return <div key={node.id} data-node-id={node.id} style={node.style as CSSProperties}>{!geometryOnly&&node.paintTree?<PaintLayer tree={node.paintTree} assetBaseURL={assetBaseURL}/>:null}{!geometryOnly&&node.contentClipStyle?<div style={node.contentClipStyle as CSSProperties}>{content}</div>:content}</div>;
  })}</>;
}
`;
