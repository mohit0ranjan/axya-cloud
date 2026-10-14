import React, { useContext, useEffect, useState } from 'react';
import { Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { nativeTransfer } from '../services/nativeTransfer';
import apiClient from '../services/apiClient';
import { ToolPage } from '../components/DriveToolLayout';
import { useTheme } from '../context/ThemeContext';

export default function DirectUploadScreen({ navigation }: any) {
  const auth = useContext(AuthContext), owner = String(auth?.user?.id || '');
  const { theme } = useTheme(); const colors = theme.colors;
  const [state,setState] = useState<any>({state:'NotConnected',ready:false});
  const [value,setValue] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const available = !!nativeTransfer?.directConfigure;
  useEffect(() => {
    let live=true;
    const poll=async()=>{if(available&&owner)try{const s=JSON.parse(await nativeTransfer!.directStatus(owner));if(live)setState(s);}catch{}};
    void poll();const timer=setInterval(poll,2000);return()=>{live=false;clearInterval(timer);};
  },[owner,available]);
  const run=async()=>{
    if(!available||!owner||busy)return;setBusy(true);setError('');
    try {
      if(state.state==='NotConnected') { const response=await apiClient.get('/upload/native-config');setState(JSON.parse(await nativeTransfer!.directConfigure(owner,JSON.stringify(response.data)))); }
      else {
        const kind=state.state==='AuthorizationStateWaitCode'?'code':state.state==='AuthorizationStateWaitPassword'?'password':state.ready||state.state==='WrongAccount'?'logout':'phone';
        setState(JSON.parse(await nativeTransfer!.directAuthenticate(owner,kind,value)));setValue('');
      }
    } catch(e:any){setError(e?.response?.data?.message||e?.message||'Unable to connect. Try again.');}finally{setBusy(false);}
  };
  const code=state.state==='AuthorizationStateWaitCode', password=state.state==='AuthorizationStateWaitPassword';
  return <ToolPage navigation={navigation} title="Direct uploads" subtitle="Send files straight from your phone to Telegram. Axya verifies each delivery before adding it to your drive.">
    <Text style={{color:colors.textHeading,fontSize:18,fontWeight:'600'}}>{state.state==='WrongAccount'?'Disconnect this account and connect your Axya Telegram account':state.ready?'Telegram connected':!available?'Install the latest Android build':code?'Enter Telegram code':password?'Telegram two-step password':'Connect your Telegram account'}</Text>
    <Text style={{color:colors.textBody,lineHeight:22}}>Use the same account you signed in with. Existing uploads keep their current route; new Saved Messages uploads use the direct connection once connected.</Text>
    {(code||password)&&<TextInput accessibilityLabel={password?'Telegram two-step password':'Telegram verification code'} value={value} onChangeText={setValue} secureTextEntry={password} autoCapitalize="none" keyboardType={code?'number-pad':'default'} style={{backgroundColor:colors.card,color:colors.textHeading,padding:18,borderRadius:18}}/>}
    {!!error&&<Text accessibilityRole="alert" style={{color:colors.danger}}>{error}</Text>}
    <Pressable disabled={!available||busy||((code||password)&&!value)} onPress={run} style={{backgroundColor:colors.primary,padding:18,borderRadius:20,opacity:busy?0.6:1}}>
      {busy?<ActivityIndicator color="white"/>:<Text style={{color:'white',textAlign:'center',fontWeight:'600'}}>{state.ready||state.state==='WrongAccount'?'Disconnect direct uploads':code||password?'Verify':state.state==='NotConnected'?'Set up direct uploads':'Send verification code'}</Text>}
    </Pressable>
  </ToolPage>;
}
