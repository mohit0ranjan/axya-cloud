async function test() {
    try {
        const res = await fetch(`https://axyzcloud-a8fgczdhhjhxexhg.centralindia-01.azurewebsites.net/share/test_token/password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'password123' })
        });
        console.log("Status:", res.status);
        console.log("Body:", await res.text());
    } catch (e) {
        console.error(e);
    }
}
test();
