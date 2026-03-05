async function test() {
    try {
        const res = await fetch(`http://localhost:3000/share/020bb4a01e2ee79e191aa1102bd63a98/password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'password123' })
        });
        console.log("Status:", res.status);
    } catch (e) {
        console.error(e);
    }
}
test();
