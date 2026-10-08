<script>
  import Popup from './Popup.svelte';

  let { onclose } = $props();
</script>

<Popup>
  <p class="text-sm font-bold">About this work</p>

  <p class="text-sm">Data source: Gaza Ministry of Health, made available by
    <a href="https://techforpalestine.org/" target="_blank" rel="noopener noreferrer" class="underline hover:text-white">Tech for Palestine</a>.
  </p>

  <p class="text-sm">Concept &amp; development: Federico Petrucci<br>
    Contact: <a href="mailto:info@stonesofgaza.com" class="underline hover:text-white">info@stonesofgaza.com</a>
  </p>

  <p class="text-sm font-bold">Controls</p>

  <p class="text-sm">WASD or ↑↓←→ to move<br>
    Autoplay starts after 8 seconds without input<br>
    Press ESC to pause
  </p>

  <div class="flex justify-end">
    <button onclick={onclose} class="bg-white rounded-md px-2 py-1 text-black font-bold cursor-pointer hover:bg-transparent hover:text-white border border-white">Close</button>
  </div>
</Popup>
