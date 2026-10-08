<script>
  import Popup from './Popup.svelte';

  let { totalCount, snapshotDate = null, onstart, oninfo } = $props();

  // UTC in lettura e in scrittura: il giorno non deve slittare col fuso del visitatore
  const asOf = $derived(snapshotDate
    ? new Date(`${snapshotDate}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
      })
    : 'today');
</script>

<Popup modal={false}>
  <div class="space-y-2">
    <p class="text-sm"><strong>"Stones of Gaza"</strong> It is an artistic installation that transforms pain into collective memory. Each vertical pillar embodies an interrupted life, creating a landscape of testimony where data from Gaza's Ministry of Health becomes digital sculptural matter. The work generates a silent dialogue between statistics and humanity, where the serial accumulation of volumes builds a living memorial that updates over time, making the invisible tangible and transforming numbers into physical presence in space.</p>
    <p class="text-sm">As of {asOf}, <span>{totalCount ?? ''}</span> pillars have been registered.</p>

    <p class="lg:hidden animate-pulse">In the mobile version, the experience is designed as an autoplay sequence, where the user passively observes the evolving memorial. On desktop, instead, the user can freely navigate and rotate around the installation, exploring the space and the pillars from different perspectives, creating a more active and immersive interaction with the memorial landscape.</p>
  </div>

  <div class="flex justify-between">
    <button onclick={oninfo} class="rounded-md h-max mt-auto px-3 py-2 text-white font-bold cursor-pointer hover:bg-white hover:text-black border border-white">Info</button>
    <button onclick={onstart} class="bg-white rounded-md h-max mt-auto px-3 py-2 text-black font-bold cursor-pointer hover:bg-transparent hover:text-white border border-white">Enter</button>
  </div>
</Popup>
