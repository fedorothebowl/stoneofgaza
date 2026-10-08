<script>
  import Popup from './Popup.svelte';

  let { onresume } = $props();
</script>

<Popup narrow>
  <p class="text-sm font-bold">Paused</p>
  <p>The memorial waits in silence.</p>
  <div class="flex justify-between items-center">
    <span>WASD or ↑↓←→ to move <br> Press F to toggle autoplay <br>Press I to get info about this work<br> </span>
    <button onclick={onresume} class="bg-white rounded-md px-2 py-1 text-black font-bold cursor-pointer hover:bg-transparent hover:text-white border border-white">Resume</button>
  </div>
</Popup>
