<template><span class="qnav-icon" aria-hidden="true"><img v-if="image&&!failed" :src="image" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failed=true"/><ClientIcon v-else :name="symbol"/></span></template>
<script setup>
import{computed,ref,watch}from'vue';
import ClientIcon from'../reference/ClientIcon.vue';
const props=defineProps({row:{type:Object,required:true},active:Boolean}),failed=ref(false),legacy={ChatDotRound:'chat',ChatLineSquare:'chat',Grid:'apps',Picture:'image',MagicStick:'star',Cpu:'model',Connection:'globe',Files:'model',DataLine:'chart',TrendCharts:'chart',Document:'file',Warning:'lock',Folder:'folder',Setting:'settings',Tools:'settings',User:'user',Microphone:'microphone',VideoCamera:'video',Message:'mail',Position:'star',Goods:'wallet',Wallet:'wallet',Ticket:'wallet',Share:'user',Menu:'apps'};
const image=computed(()=>props.row.iconMode==='image'?(props.active&&props.row.activeIconUrl||props.row.iconUrl||''):''),symbol=computed(()=>{const value=props.active&&props.row.activeIcon||props.row.icon||'apps';return legacy[value]||value;});watch(image,()=>failed.value=false);
</script>
