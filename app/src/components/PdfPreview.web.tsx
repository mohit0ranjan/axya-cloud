import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import {useTheme} from '../context/ThemeContext';
import DocumentPreviewCard from './DocumentPreviewCard';
import {buildApiFileUrl} from '../utils/fileSafety';
type Props={baseUrl:string;fileId:string;token:string;name:string;active:boolean;sizeBytes:number;revision?:string;offlineUri?:string};
export default function PdfPreview({baseUrl,fileId,token,name,active,sizeBytes,offlineUri,revision}:Props){
 const {theme}=useTheme();const [uri,setUri]=useState<string|undefined>(offlineUri),[error,setError]=useState('');
 useEffect(()=>{if(offlineUri){setUri(offlineUri);return;}setUri(undefined);setError('');if(!active||sizeBytes>64*1024**2)return;let alive=true;let blobUrl:string|undefined;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),120000);fetch(buildApiFileUrl(baseUrl,fileId,'download') + (revision ? '?v='+encodeURIComponent(revision) : ''),{headers:{Authorization:`Bearer ${token}`},signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('PDF could not load. Download it to open in another app.');const blob=await r.blob();if(blob.size!==sizeBytes)throw new Error('Incomplete PDF download. Retry the preview.');blobUrl=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));if(alive)setUri(blobUrl);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>clearTimeout(timer));return()=>{alive=false;controller.abort();clearTimeout(timer);if(blobUrl)URL.revokeObjectURL(blobUrl);};},[revision,baseUrl,fileId,token,active,sizeBytes,offlineUri]);
 if(!active)return null;if(error||(!offlineUri&&sizeBytes>64*1024**2))return <DocumentPreviewCard name={name} mimeType="application/pdf"/>;
 if(!uri)return <View style={{flex:1,alignItems:'center',justifyContent:'center',gap:16}}><ActivityIndicator color={theme.colors.primary}/><Text style={{color:theme.colors.textBody}}>Preparing PDF…</Text></View>;
 return React.createElement('iframe',{title:name,src:uri,style:{width:'100%',height:'100%',border:0,background:'white'}});
}
