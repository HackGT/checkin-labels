
function setupButtonHandlers(className: string, handler: (id: string) => Promise<void>) {
	let buttons = document.getElementsByClassName(className) as HTMLCollectionOf<HTMLButtonElement>;
	if (buttons.length === 0) {
		console.warn(`Didn't find any buttons for class: ${className}`);
	}
	for (let i = 0; i < buttons.length; i++) {
		buttons[i].addEventListener("click", async e => {
			let button = e.target as HTMLButtonElement;
			let deviceUsername = button.parentElement!.dataset.username;
			if (deviceUsername) {
				button.disabled = true;
				await handler(deviceUsername);
				button.disabled = false;
			}
		});
	}
}

interface APIResponse {
	success?: boolean,
	error?: string,
	details?: string,
}
async function makeButtonRequest(url: string, username: string): Promise<APIResponse> {
	return fetch(url, {
		method: "POST",
		credentials: "include",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ username })
	}).then(response => response.json());
}

setupButtonHandlers("action-authorize", async id => {
	let response = await makeButtonRequest("/api/device/authorize", id);
	if (response.success) {
		window.location.reload();
	}
	else {
		alert(`${response.error} (${response.details || "No details"})`);
	}
});
setupButtonHandlers("action-reject", async id => {
	let response = await makeButtonRequest("/api/device/reject", id);
	if (response.success) {
		window.location.reload();
	}
	else {
		alert(`${response.error} (${response.details || "No details"})`);
	}
});
setupButtonHandlers("action-force-renew", async id => {
	let response = await makeButtonRequest("/api/device/force-renew", id);
	if (response.success) {
		window.location.reload();
	}
	else {
		alert(`${response.error} (${response.details || "No details"})`);
	}
});
setupButtonHandlers("action-delete", async id => {
	let response = await makeButtonRequest("/api/device/delete", id);
	if (response.success) {
		window.location.reload();
	}
	else {
		alert(`${response.error} (${response.details || "No details"})`);
	}
});
setupButtonHandlers("action-rename", async id => {
	let name = prompt("New device name:");
	if (!name) return;
	let response = await fetch("/api/device/rename", {
		method: "POST",
		credentials: "include",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ username: id, name })
	}).then(response => response.json());
	if (response.success) {
		window.location.reload();
	}
	else {
		alert(`${response.error} (${response.details || "No details"})`);
	}
});

let selects = document.getElementsByClassName("tag-select") as HTMLCollectionOf<HTMLSelectElement>;
for (let i = 0; i < selects.length; i++) {
	selects[i].addEventListener("change", async e => {
		let select = e.target as HTMLButtonElement;
		let deviceUsername = select.dataset.username;
		if (deviceUsername) {
			select.disabled = true;
			let response: APIResponse = await fetch("/api/device/set-tag", {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({ username: deviceUsername, tag: select.value })
			}).then(response => response.json());
			if (!response.success) {
				alert(`${response.error} (${response.details || "No details"})`);
			}
			select.disabled = false;
		}
	});
}
