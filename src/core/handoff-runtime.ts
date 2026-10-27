/** Portable generated React runtime; receives only an explicitly supplied registered library. */
export const handoffRuntime = `import { Component, createElement, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { resolveImageAsset } from "./imageResources";
export type PaintTree = {tag:"div"|"img"|"svg"|"defs"|"pattern"|"image"|"rect";props:Record<string,unknown>;children:PaintTree[]};
function PaintLayer({tree,assetBaseURL}:{tree:PaintTree;assetBaseURL?:string}):ReactNode{const props={...tree.props};for(const key of ["src","href"])if(typeof props[key]==="string")props[key]=resolveImageAsset(props[key],assetBaseURL);return createElement(tree.tag,props,...tree.children.map((child,index)=><PaintLayer key={index} tree={child} assetBaseURL={assetBaseURL}/>))}
export type HandoffNode = { id:string; type:string; props:Record<string,unknown>; slots:Record<string,HandoffNode[]>; hidden?:boolean; paintTree?:PaintTree; scene?:{kind:string;width:number;height:number;fill?:string;stroke?:string;strokeWidth?:number;path?:string;fontSize?:number;textStyle?:{direction?:"ltr"|"rtl"|"auto"}}; style:Record<string,string|number>; contentStyle?:Record<string,string|number> };
export type RegisteredLibrary = { id:string; version:string; components:Record<string,{defaultProps:Record<string,unknown>;render:ComponentType<Record<string,any>>}> };
class Boundary extends Component<{children:ReactNode},{error:string}> {
  state={error:""}; static getDerivedStateFromError(error:Error){return {error:error.message}};
  render(){return this.state.error?<div role="alert">Компонент требует контекст: {this.state.error}</div>:this.props.children}
}
export function RenderNodes({nodes,library,expected,assetBaseURL}:{nodes:HandoffNode[];library:RegisteredLibrary;expected:{id:string;version:string};assetBaseURL?:string}){
  return <>{nodes.filter(node=>!node.hidden).map(node=>{
    const definition = library.id===expected.id&&library.version===expected.version?library.components[node.type]:undefined;
    const children = Object.entries(node.slots).map(([slot,rows])=><div key={slot} data-slot={slot}><RenderNodes nodes={rows} library={library} expected={expected} assetBaseURL={assetBaseURL}/></div>);
    let content:ReactNode;
    if(node.scene?.kind==="text") content=<div dir={node.scene.textStyle?.direction} style={(node.contentStyle??{fontSize:node.scene.fontSize??16,whiteSpace:"pre-wrap",overflowWrap:"anywhere",lineHeight:1.4}) as CSSProperties}>{String(node.props.text??"")}</div>;
    else if(node.scene?.kind==="vector") content=<svg width="100%" height="100%" viewBox={"0 0 "+node.scene.width+" "+node.scene.height}><path d={node.scene.path??""} fill={node.scene.fill??"none"} stroke={node.scene.stroke} strokeWidth={node.scene.strokeWidth??1}/></svg>;
    else if(node.type==="StudioImage"||node.scene?.kind==="image") content=<img src={resolveImageAsset(String(node.props.src??""),assetBaseURL)} alt={String(node.props.alt??"")} style={{width:"100%",height:"100%",objectFit:node.props.objectFit==="cover"?"cover":"contain",objectPosition:String(node.props.objectPosition??"50% 50%")}}/>;
    else if((node.scene?.kind==="frame"||node.type==="SceneFrame")) content=Object.entries(node.slots).map(([slot,rows])=><RenderNodes key={slot} nodes={rows} library={library} expected={expected} assetBaseURL={assetBaseURL}/>);
    else if(definition){const Renderer=definition.render;content=<Boundary><Renderer {...definition.defaultProps} {...node.props} {...(children.length?{children}:{})}/></Boundary>}
    else content=<div role="status">Недоступен {node.type} · исходные данные сохранены</div>;
    return <div key={node.id} data-node-id={node.id} style={node.style as CSSProperties}>{node.paintTree?<PaintLayer tree={node.paintTree} assetBaseURL={assetBaseURL}/>:null}{content}</div>;
  })}</>;
}
`;
