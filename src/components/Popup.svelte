<script>
  // Cornice comune ai popup: overlay a tutto schermo con pannello centrato
  let { modal = true, narrow = false, children } = $props();
</script>

<div class={['w-screen h-screen fixed inset-0 grid place-items-center', modal ? 'z-100' : 'z-[1] m-auto']}>
  <div class={['bg-black/50 w-[90%] max-w-max m-auto h-max text-xs p-4 rounded-md space-y-2.5', narrow ? 'md:max-w-md' : 'md:max-w-xl']}>
    {@render children()}
  </div>
</div>
