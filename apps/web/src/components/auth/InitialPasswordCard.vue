<template><PhoneIdentityCard v-if="profile?.passwordConfigured===false||pending" :profile="profile" :active="active" :blocked="blocked" initial @busy="$emit('busy',$event)" @profile-received="$emit('profile-received',$event)" @setup-completed="pending=false"/></template>
<script setup>
import {ref,watch} from 'vue';
import {useAuth} from '../../stores/auth.js';
import {readPhonePending} from '../../lib/phone-pending.js';
import PhoneIdentityCard from './PhoneIdentityCard.vue';
const props=defineProps({profile:Object,active:Boolean,blocked:Boolean}),emit=defineEmits(['busy','profile-received']),auth=useAuth(),pending=ref(false);
watch(()=>[props.active,auth.user?.id,auth.identityRevision,props.profile?.updatedAt],()=>{pending.value=!!auth.user?.id&&!!readPhonePending('action',auth.user.id,'initial');},{immediate:true});
</script>
