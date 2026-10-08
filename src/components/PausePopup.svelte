<script>
  import Popup from './Popup.svelte';

  let { onresume, oninfo } = $props();
</script>

<Popup narrow>
  <p class="text-sm font-bold">Paused</p>
  <p>The memorial waits in silence.</p>
  <div class="flex justify-between items-center">
    <button onclick={oninfo} class="rounded-md px-2 py-1 text-white font-bold cursor-pointer hover:bg-white hover:text-black border border-white">Info</button>
    <button onclick={onresume} class="bg-white rounded-md px-2 py-1 text-black font-bold cursor-pointer hover:bg-transparent hover:text-white border border-white">Resume</button>
  </div>
</Popup>
